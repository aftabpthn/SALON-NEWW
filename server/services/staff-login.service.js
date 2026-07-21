import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { columnsFor, db } from "../db.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";
import { realtimeService } from "./realtime.service.js";
import { ensureTenantUserAccessColumns, normalizeBranchIdsForRole } from "./access-control.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;
const privilegedRoles = new Set(["superAdmin", "owner", "admin"]);
const istDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function istBusinessDate(value = new Date()) {
  return istDateFormatter.format(value);
}

function istDayBoundary(dateText, endOfDay = false) {
  const [year, month, day] = dateText.split("-").map(Number);
  const start = Date.UTC(year, month - 1, day, -5, -30);
  return new Date(start + (endOfDay ? 86400000 - 1 : 0)).toISOString();
}

function normalizeRole(role = "") {
  const value = String(role || "").trim();
  const compact = value.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "superadmin") return "superAdmin";
  if (compact === "frontdesk") return "frontDesk";
  if (compact === "inventorymanager") return "inventoryManager";
  if (compact === "custommarketinglead") return "customMarketingLead";
  return value;
}

function json(value) {
  return JSON.stringify(value ?? []);
}

function parseJsonArray(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeLoginId(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function defaultLoginIdForStaff(staff = {}) {
  const emailPrefix = String(staff.email || "").split("@")[0];
  return normalizeLoginId(staff.employeeCode || staff.employee_code || emailPrefix || staff.mobile || staff.id);
}

function temporaryPassword() {
  return `Aura@${randomBytes(18).toString("base64url")}`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return {
    passwordSalt: salt,
    passwordHash: scryptSync(String(password || ""), salt, 64).toString("hex")
  };
}

function safeEmail(loginId, fallbackEmail = "") {
  const email = normalizeLoginId(fallbackEmail);
  if (email) return email;
  return loginId.includes("@") ? loginId : `${loginId}@staff.local`;
}

function rowToStaff(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    fullName: row.full_name,
    firstName: row.first_name,
    lastName: row.last_name,
    mobile: row.mobile,
    email: row.email,
    roleId: row.role_id || "staff",
    department: row.department || "",
    designation: row.designation || "",
    status: row.status || "active"
  };
}

function legacyRowToStaff(row) {
  if (!row) return null;
  const name = String(row.name || "").trim();
  const [firstName = name, ...rest] = name.split(/\s+/).filter(Boolean);
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    fullName: name,
    firstName,
    lastName: rest.join(" "),
    mobile: row.phone || "",
    email: row.email || "",
    roleId: row.role || "staff",
    department: "",
    designation: row.role || "",
    status: row.status || "active"
  };
}

function rowToAuthUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    loginId: row.loginId || "",
    email: row.email,
    role: row.role,
    staffId: row.staffId || "",
    branchIds: parseJsonArray(row.branchIds),
    status: row.status || "active",
    passwordSet: Boolean(row.passwordHash)
  };
}

function parseServiceIds(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || "")).filter(Boolean);
  } catch {
    return [];
  }
  return [];
}

function appointmentValue(row) {
  return Number(row.estimatedAmount || row.amount || row.total || row.price || 0);
}

function toIsoBoundary(value, fallbackDate, endOfDay = false) {
  const text = String(value || "").trim();
  const raw = text || fallbackDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return istDayBoundary(raw, endOfDay);
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallbackDate : date.toISOString();
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function safeAll(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function safeGet(sql, params = {}) {
  try {
    return db.prepare(sql).get(params) || null;
  } catch {
    return null;
  }
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value) {
  return Math.max(0, Math.min(100, Math.round(number(value))));
}

function hourLabel(hour) {
  const normalized = Math.max(0, Math.min(23, Number(hour || 0)));
  return `${String(normalized).padStart(2, "0")}:00`;
}

let staffSelfAppSchemaReady = false;

function ensureStaffSelfAppSchema() {
  if (staffSelfAppSchemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS staffChatThreads (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      title TEXT NOT NULL,
      channel TEXT DEFAULT 'branch',
      createdBy TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staffChatMessages (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      threadId TEXT NOT NULL,
      senderStaffId TEXT NOT NULL,
      senderName TEXT DEFAULT '',
      body TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      readByJson TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS staffLearningModules (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'service',
      durationMinutes INTEGER DEFAULT 10,
      status TEXT DEFAULT 'active',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staffLearningProgress (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      staffId TEXT NOT NULL,
      moduleId TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      completedAt TEXT DEFAULT '',
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, staffId, moduleId)
    );
    CREATE TABLE IF NOT EXISTS staffClientMedia (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'photo',
      url TEXT DEFAULT '',
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staffSelfAudit (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      staffId TEXT NOT NULL,
      action TEXT NOT NULL,
      targetType TEXT DEFAULT '',
      targetId TEXT DEFAULT '',
      detailsJson TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL
    );
  `);
  staffSelfAppSchemaReady = true;
}

function writeStaffSelfAudit(action, targetType, targetId, access = {}, branchId = "", staffId = "", details = {}) {
  ensureStaffSelfAppSchema();
  const row = {
    id: makeId("audit"),
    tenantId: access.tenantId || "tenant_aura",
    branchId: branchId || access.branchId || "",
    staffId: staffId || access.staffId || "",
    action,
    targetType,
    targetId,
    detailsJson: JSON.stringify(details || {}),
    createdAt: now()
  };
  safeRun(`INSERT INTO staffSelfAudit (id, tenantId, branchId, staffId, action, targetType, targetId, detailsJson, createdAt)
    VALUES (@id, @tenantId, @branchId, @staffId, @action, @targetType, @targetId, @detailsJson, @createdAt)`, row);
  return row;
}

function safeRun(sql, params = {}) {
  try {
    return db.prepare(sql).run(params);
  } catch {
    return null;
  }
}

function scopedFilters(table, access, branchId = "") {
  const columns = columnsFor(table);
  const filters = [];
  const params = [];
  if (columns.includes("tenantId") && access.tenantId) {
    filters.push("tenantId = ?");
    params.push(access.tenantId);
  }
  if (columns.includes("branchId") && branchId) {
    filters.push("branchId = ?");
    params.push(branchId);
  }
  return { filters, params };
}

export class StaffLoginService {
  syncCoreStaffFromStaffMaster(staffOrId, access) {
    const staff = typeof staffOrId === "string" ? this.getStaff(staffOrId, access) : staffOrId;
    if (!staff?.id) return null;
    if (!staff.branchId || !db.prepare("SELECT id FROM branches WHERE id = ?").get(staff.branchId)) {
      return null;
    }
    const existing = db.prepare("SELECT * FROM staff WHERE id = ?").get(staff.id);
    const row = {
      id: staff.id,
      name: staff.fullName || staff.firstName || "Staff",
      role: staff.roleId || staff.designation || "staff",
      phone: staff.mobile || "",
      email: staff.email || "",
      branchId: staff.branchId,
      image: staff.profilePhoto || staff.profile_photo || existing?.image || "",
      shift: "",
      status: staff.status || "active",
      assignedServices: "[]",
      commissionRule: "{}",
      attendance: "[]",
      performance: "{}",
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    if (existing) {
      db.prepare(`UPDATE staff
        SET name = @name, role = @role, phone = @phone, email = @email, branchId = @branchId,
            image = @image, status = @status, updatedAt = @updatedAt
        WHERE id = @id`).run(row);
    } else {
      db.prepare(`INSERT INTO staff (
        id, name, role, phone, email, branchId, image, shift, status, assignedServices,
        commissionRule, attendance, performance, createdAt, updatedAt
      ) VALUES (
        @id, @name, @role, @phone, @email, @branchId, @image, @shift, @status, @assignedServices,
        @commissionRule, @attendance, @performance, @createdAt, @updatedAt
      )`).run(row);
    }
    return row;
  }

  upsertStaffLogin(staffOrId, payload = {}, access) {
    ensureTenantUserAccessColumns();
    const staff = typeof staffOrId === "string" ? this.getStaff(staffOrId, access) : staffOrId;
    if (!staff?.id) throw notFound("Staff record not found");
    if (!privilegedRoles.has(normalizeRole(access.role))) throw forbidden("Only owner, admin or super admin can provision staff login");
    const loginId = normalizeLoginId(payload.loginId || payload.login_id || payload.email || defaultLoginIdForStaff(staff));
    if (!loginId) throw badRequest("Staff login ID is required");
    const email = safeEmail(loginId, payload.email || staff.email);
    const requestedRole = String(payload.role || payload.roleId || staff.roleId || "staff").trim();
    const authRole = ["manager", "frontDesk", "cashier", "staff", "marketingLead", "customMarketingLead", "inventoryManager", "accountant"].includes(normalizeRole(requestedRole)) ? normalizeRole(requestedRole) : "staff";
    const branchIds = normalizeBranchIdsForRole(payload.branchIds || [staff.branchId].filter(Boolean), authRole);
    const existingByStaff = db.prepare("SELECT * FROM tenant_users WHERE tenantId = @tenantId AND staffId = @staffId")
      .get({ tenantId: access.tenantId, staffId: staff.id });
    const existingByLogin = db.prepare(`SELECT * FROM tenant_users
      WHERE tenantId = @tenantId
        AND id != @existingId
        AND (lower(loginId) IN (lower(@loginId), lower(@email)) OR lower(email) IN (lower(@loginId), lower(@email)))
      LIMIT 1`).get({ tenantId: access.tenantId, existingId: existingByStaff?.id || "", loginId, email });
    if (existingByLogin) {
      throw badRequest("This login ID or email is already used by another account");
    }
    const existing = existingByStaff;
    const generatedPassword = payload.autoProvision && !payload.password ? temporaryPassword() : "";
    if (!existing && !payload.password && !generatedPassword) throw badRequest("Password is required when creating staff login");
    const passwordPatch = payload.password || generatedPassword ? hashPassword(payload.password || generatedPassword) : {
      passwordSalt: existing?.passwordSalt || "",
      passwordHash: existing?.passwordHash || ""
    };
    const row = {
      id: existing?.id || makeId("usr"),
      tenantId: access.tenantId,
      name: staff.fullName || staff.firstName || "Staff",
      loginId,
      email,
      role: authRole,
      branchIds: json(branchIds),
      staffId: staff.id,
      passwordSalt: passwordPatch.passwordSalt,
      passwordHash: passwordPatch.passwordHash,
      failedLoginCount: 0,
      lockedUntil: "",
      lastLoginAt: existing?.lastLoginAt || "",
      status: payload.autoProvision ? "pending_activation" : payload.status || existing?.status || "active",
      accessApprovedBy: access.userId || existing?.accessApprovedBy || "",
      accessApprovedAt: existing?.accessApprovedAt || now(),
      permissionVersion: Number(existing?.permissionVersion || 1) + (existing ? 1 : 0),
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    if (existing) {
      db.prepare(`UPDATE tenant_users SET
        name = @name, loginId = @loginId, email = @email, role = @role, branchIds = @branchIds,
        staffId = @staffId, passwordSalt = @passwordSalt, passwordHash = @passwordHash,
        failedLoginCount = @failedLoginCount, lockedUntil = @lockedUntil, status = @status,
        accessApprovedBy = @accessApprovedBy, accessApprovedAt = @accessApprovedAt, permissionVersion = @permissionVersion,
        updatedAt = @updatedAt
        WHERE id = @id AND tenantId = @tenantId`).run(row);
    } else {
      db.prepare(`INSERT INTO tenant_users (
        id, tenantId, name, loginId, email, role, branchIds, staffId, passwordSalt, passwordHash,
        failedLoginCount, lockedUntil, lastLoginAt, status, accessApprovedBy, accessApprovedAt, permissionVersion, createdAt, updatedAt
      ) VALUES (
        @id, @tenantId, @name, @loginId, @email, @role, @branchIds, @staffId, @passwordSalt, @passwordHash,
        @failedLoginCount, @lockedUntil, @lastLoginAt, @status, @accessApprovedBy, @accessApprovedAt, @permissionVersion, @createdAt, @updatedAt
      )`).run(row);
    }
    return rowToAuthUser(db.prepare("SELECT * FROM tenant_users WHERE id = ? AND tenantId = ?").get(row.id, access.tenantId));
  }

  ensureStaffLogin(staffOrId, access) {
    ensureTenantUserAccessColumns();
    const staff = typeof staffOrId === "string" ? this.getStaff(staffOrId, access) : staffOrId;
    if (!staff?.id) throw notFound("Staff record not found");
    const existing = db.prepare("SELECT * FROM tenant_users WHERE tenantId = @tenantId AND staffId = @staffId")
      .get({ tenantId: access.tenantId, staffId: staff.id });
    if (existing) return rowToAuthUser(existing);
    return null;
  }

  getStaffLogin(staffId, access) {
    const staff = this.getStaff(staffId, access);
    const row = db.prepare("SELECT * FROM tenant_users WHERE tenantId = ? AND staffId = ?").get(access.tenantId, staff.id);
    return { staffId: staff.id, login: rowToAuthUser(row), hasLogin: Boolean(row) };
  }

  staffDashboard(query = {}, access) {
    const staffId = this.resolveStaffId(query, access);
    const staff = this.getStaff(staffId, access);
    const identityIds = this.staffIdentityIds(staff, access.tenantId);
    const todayText = istBusinessDate();
    const from = toIsoBoundary(query.from, new Date(Date.now() - 30 * 86400000).toISOString());
    const to = toIsoBoundary(query.to, new Date(Date.now() + 30 * 86400000).toISOString(), true);
    const businessDate = String(query.date || todayText).slice(0, 10);
    const todayStart = istDayBoundary(businessDate);
    const todayEnd = new Date(new Date(todayStart).getTime() + 86400000).toISOString();
    const idsSql = placeholders(identityIds);
    const appointmentScope = scopedFilters("appointments", access, staff.branchId);
    const appointmentRows = db.prepare(`SELECT * FROM appointments
      WHERE ${[...appointmentScope.filters, `staffId IN (${idsSql})`, "startAt >= ?", "startAt <= ?"].join(" AND ")}
      ORDER BY startAt ASC LIMIT 500`).all(...appointmentScope.params, ...identityIds, from, to);
    const todayScope = scopedFilters("appointments", access, staff.branchId);
    const todayRows = db.prepare(`SELECT * FROM appointments
      WHERE ${[...todayScope.filters, `staffId IN (${idsSql})`, "startAt >= ?", "startAt < ?"].join(" AND ")}
      ORDER BY startAt ASC LIMIT 200`).all(...todayScope.params, ...identityIds, todayStart, todayEnd);
    const salesScope = scopedFilters("sales", access, staff.branchId);
    const salesRows = db.prepare(`SELECT * FROM sales
      WHERE ${[...salesScope.filters, `staffId IN (${idsSql})`, "createdAt >= ?", "createdAt <= ?"].join(" AND ")}
      ORDER BY createdAt DESC LIMIT 500`).all(...salesScope.params, ...identityIds, from, to);
    const enriched = this.enrichAppointments(appointmentRows, access.tenantId);
    const liveStatuses = new Set(["booked", "confirmed", "checked-in", "arrived", "in-service", "started"]);
    const today = this.enrichAppointments(todayRows, access.tenantId);
    const completed = enriched.filter((row) => ["completed", "checked-out"].includes(String(row.status || "").toLowerCase()));
    return {
      staff,
      identityIds,
      range: { from, to, date: businessDate },
      summary: {
        appointments: enriched.length,
        todayAppointments: today.length,
        liveAppointments: today.filter((row) => liveStatuses.has(String(row.status || "").toLowerCase())).length,
        completedAppointments: completed.length,
        cancelledAppointments: enriched.filter((row) => ["cancelled", "no-show"].includes(String(row.status || "").toLowerCase())).length,
        salesCount: salesRows.length,
        revenue: salesRows.reduce((sum, row) => sum + Number(row.total || 0), 0),
        appointmentValue: enriched.reduce((sum, row) => sum + appointmentValue(row), 0)
      },
      liveAppointments: today.filter((row) => liveStatuses.has(String(row.status || "").toLowerCase())),
      todayAppointments: today,
      workReport: completed,
      appointments: enriched,
      sales: salesRows.map((row) => ({
        id: row.id,
        clientId: row.clientId,
        appointmentId: row.appointmentId || "",
        total: Number(row.total || 0),
        commissionTotal: Number(row.commissionTotal || 0),
        status: row.status,
        createdAt: row.createdAt
      }))
    };
  }

  enterpriseOs(query = {}, access) {
    const dashboard = this.staffDashboard(query, access);
    const staffId = dashboard.staff.id;
    const branchId = dashboard.staff.branchId || access.branchId || "";
    const date = String(query.date || dashboard.range.date || istBusinessDate()).slice(0, 10);
    const nowDate = new Date();
    const todayAppointments = dashboard.todayAppointments || [];
    const completed = dashboard.workReport || [];
    const expectedRevenue = todayAppointments.reduce((sum, item) => sum + appointmentValue(item), 0);
    const targetRows = safeAll(
      `SELECT * FROM staff_targets WHERE tenant_id = @tenantId AND staff_id = @staffId ORDER BY created_at DESC LIMIT 12`,
      { tenantId: access.tenantId, staffId }
    );
    const taskRows = safeAll(
      `SELECT * FROM staff_tasks WHERE tenant_id = @tenantId AND staff_id = @staffId ORDER BY due_at IS NULL, due_at ASC, created_at DESC LIMIT 20`,
      { tenantId: access.tenantId, staffId }
    );
    const performanceRows = safeAll(
      `SELECT * FROM staff_performance_daily WHERE tenant_id = @tenantId AND staff_id = @staffId ORDER BY business_date DESC LIMIT 370`,
      { tenantId: access.tenantId, staffId }
    );
    const notificationRows = safeAll(
      `SELECT * FROM staff_notifications WHERE tenantId = @tenantId AND staffId = @staffId ORDER BY createdAt DESC LIMIT 20`,
      { tenantId: access.tenantId, staffId }
    ).concat(safeAll(
      `SELECT * FROM staff_notifications WHERE tenant_id = @tenantId AND staff_id = @staffId ORDER BY created_at DESC LIMIT 20`,
      { tenantId: access.tenantId, staffId }
    ));
    const scheduleRows = safeAll(
      `SELECT * FROM staff_schedules WHERE tenant_id = @tenantId AND staff_id = @staffId ORDER BY schedule_date ASC LIMIT 60`,
      { tenantId: access.tenantId, staffId }
    );
    const leaderboardBranchFilter = branchId ? " AND branch_id = @branchId" : "";
    const leaderboardRows = safeAll(
      `SELECT staff_id, SUM(revenue_generated) AS revenue, AVG(productivity_score) AS score, AVG(avg_rating) AS rating, COUNT(*) AS days
         FROM staff_performance_daily
        WHERE tenant_id = @tenantId${leaderboardBranchFilter}
        GROUP BY staff_id
        ORDER BY score DESC
        LIMIT 20`,
      { tenantId: access.tenantId, branchId }
    );
    const clientIds = [...new Set(todayAppointments.map((item) => item.clientId).filter(Boolean))];
    const clientSpend = this.clientSpendMap(access.tenantId, clientIds);
    const lateClients = todayAppointments.filter((item) => this.isLateAppointment(item, nowDate));
    const vipClients = todayAppointments.filter((item) => number(clientSpend.get(item.clientId)) >= 25000);
    const birthdayClients = this.birthdayClients(access.tenantId, clientIds, date);
    const pendingPayments = this.pendingPayments(access.tenantId, clientIds);
    const targetProgress = this.targetProgress(targetRows, expectedRevenue);
    const busiestHour = this.busiestHour(todayAppointments);
    const revenueMore = Math.max(0, number(targetProgress.targetValue) - number(targetProgress.achievedValue));
    const completedTasks = taskRows.filter((item) => String(item.status || "").toLowerCase() === "completed").length;
    const points = Math.round(completed.length * 20 + expectedRevenue / 1000 + completedTasks * 10);

    return {
      staff: dashboard.staff,
      home: {
        greeting: `Good Morning ${dashboard.staff.firstName || dashboard.staff.fullName || access.loginId || "Staff"}`,
        date,
        todayAppointments: todayAppointments.length,
        expectedRevenue,
        targetProgress,
        attendance: dashboard.identityIds?.length ? "connected" : "not linked",
        tasks: taskRows.filter((item) => String(item.status || "open") !== "completed").length,
        breakStatus: "available",
        lateClients: lateClients.length,
        vipClients: vipClients.length,
        birthdayClients: birthdayClients.length,
        pendingReviews: 0,
        pendingPayments: pendingPayments.length,
        serviceQueue: todayAppointments.length,
        recentNotifications: notificationRows.length
      },
      aiCoach: this.staffCoachCards({ dashboard, revenueMore, vipClients, pendingPayments, targetProgress, busiestHour }),
      timeline: todayAppointments.map((item) => this.timelineItem(item, nowDate)),
      clientSignals: { lateClients, vipClients, birthdayClients, pendingPayments },
      serviceTimers: todayAppointments.map((item) => this.serviceTimer(item, nowDate)),
      performance: this.performanceIntelligence(dashboard, performanceRows),
      leaderboard: this.leaderboard(leaderboardRows, staffId, access.tenantId),
      gamification: {
        points,
        level: Math.max(1, Math.floor(points / 100) + 1),
        stars: Math.min(5, Math.max(1, Math.floor(points / 120) + 1)),
        dailyStreak: performanceRows.length,
        monthlyStreak: performanceRows.filter((row) => String(row.business_date || "").startsWith(date.slice(0, 7))).length,
        badges: this.badges({ dashboard, points, targetProgress })
      },
      notifications: notificationRows.slice(0, 10).map((row) => ({
        id: row.id,
        title: row.title || row.notification_type || row.type || "Staff notification",
        body: row.body || row.message || row.payload || "",
        status: row.status || "unread",
        createdAt: row.createdAt || row.created_at || ""
      })),
      tasks: taskRows.map((row) => ({
        id: row.id,
        title: row.title,
        priority: row.priority || "medium",
        status: row.status || "open",
        dueAt: row.due_at || row.dueAt || "",
        assignedBy: row.assigned_by || row.assignedBy || "",
        checklist: []
      })),
      calendar: scheduleRows.map((row) => ({
        id: row.id,
        date: row.schedule_date || row.date || "",
        startTime: row.start_time || row.startTime || "",
        endTime: row.end_time || row.endTime || "",
        type: row.shift_type || row.shiftType || "roster",
        status: row.status || "planned",
        version: number(row.version || 1)
      })),
      quickActions: [
        { key: "clock-in", label: "Clock in", enabled: true },
        { key: "start-break", label: "Start break", enabled: true },
        { key: "request-leave", label: "Request leave", enabled: true },
        { key: "complete-task", label: "Complete task", enabled: taskRows.length > 0 }
      ],
      reports: {
        daily: this.performanceWindow(performanceRows, 1),
        weekly: this.performanceWindow(performanceRows, 7),
        monthly: this.performanceWindow(performanceRows, 31),
        yearly: this.performanceWindow(performanceRows, 365)
      }
    };
  }

  clients(query = {}, access) {
    const dashboard = this.staffDashboard({}, access);
    const branchId = dashboard.staff.branchId || access.branchId || "";
    const columns = columnsFor("clients");
    const q = String(query.q || query.search || "").trim().toLowerCase();
    const params = {
      tenantId: access.tenantId,
      branchId,
      q: q ? `%${q}%` : "",
      limit: Math.min(Math.max(number(query.limit || 80), 1), 200)
    };
    const filters = [];
    if (columns.includes("tenantId")) filters.push("tenantId = @tenantId");
    if (columns.includes("branchId") && branchId) filters.push("branchId = @branchId");
    if (params.q) filters.push("(lower(COALESCE(name, '')) LIKE @q OR lower(COALESCE(phone, '')) LIKE @q OR lower(COALESCE(email, '')) LIKE @q)");
    const where = filters.length ? filters.join(" AND ") : "1 = 1";
    return safeAll(`SELECT * FROM clients WHERE ${where} ORDER BY COALESCE(lastVisitAt, updatedAt, createdAt, '') DESC, name ASC LIMIT @limit`, params).map((row) => ({
      id: row.id,
      name: row.name || row.fullName || row.id,
      phone: row.phone || row.mobile || "",
      email: row.email || "",
      branchId: row.branchId || "",
      tags: parseJsonArray(row.tags),
      totalSpend: number(row.totalSpend || row.totalSpendPaise || 0),
      visitCount: number(row.visitCount || 0),
      lastVisitAt: row.lastVisitAt || row.lastVisit || "",
      membershipStatus: row.membershipStatus || row.membership || ""
    }));
  }

  client360(clientId, query = {}, access) {
    ensureStaffSelfAppSchema();
    const dashboard = this.staffDashboard(query, access);
    const branchId = dashboard.staff.branchId || access.branchId || "";
    const client = this.clientRecord(access.tenantId, branchId, clientId);
    if (!client) throw notFound("Client record not found");
    const appointments = this.clientAppointments(access.tenantId, branchId, clientId);
    const sales = this.clientSales(access.tenantId, branchId, clientId);
    const lifetimeSpend = sales.reduce((sum, row) => sum + number(row.total), 0);
    const cancellations = appointments.filter((row) => ["cancelled", "no-show"].includes(String(row.status || "").toLowerCase()));
    const lastVisit = appointments.find((row) => ["completed", "checked-out"].includes(String(row.status || "").toLowerCase())) || appointments[0] || null;
    const retentionScore = Math.max(0, Math.min(100, Math.round((appointments.length * 8) + (lifetimeSpend / 1000) - (cancellations.length * 12))));
    return {
      profile: {
        id: client.id,
        name: client.name || client.fullName || clientId,
        phone: client.phone || client.mobile || "",
        email: client.email || "",
        photo: client.photo || client.image || "",
        birthday: client.birthday || client.dateOfBirth || "",
        notes: client.notes || "",
        allergies: client.allergies || "",
        preferredStylist: client.preferredStylist || client.preferredStaffId || dashboard.staff.fullName || ""
      },
      membership: { status: client.membershipStatus || client.membership || "", plan: client.membershipPlan || "" },
      packages: [],
      wallet: { balance: number(client.walletBalance || client.walletBalancePaise) },
      outstandingBalance: sales.reduce((sum, row) => sum + Math.max(0, number(row.total) - number(row.paid)), 0),
      previousServices: appointments.map((row) => ({ id: row.id, startAt: row.startAt, status: row.status, serviceIds: parseServiceIds(row.serviceIds) })),
      productsBought: sales.map((row) => ({ id: row.id, total: number(row.total), createdAt: row.createdAt, status: row.status })),
      cancellationHistory: cancellations.map((row) => ({ id: row.id, startAt: row.startAt, status: row.status, notes: row.notes || "" })),
      preferences: {
        notes: client.notes || "",
        allergies: client.allergies || "",
        tags: parseJsonArray(client.tags),
        preferredStylist: client.preferredStylist || client.preferredStaffId || dashboard.staff.fullName || ""
      },
      mediaPortfolio: this.clientMedia(access.tenantId, branchId, clientId),
      lifetimeSpend,
      visitFrequency: appointments.length,
      lastVisit: lastVisit?.startAt || "",
      retentionScore,
      aiRecommendations: this.clientRecommendations({ client, appointments, sales, lifetimeSpend, retentionScore })
    };
  }

  updateStaffNotification(id, payload = {}, access) {
    ensureStaffSelfAppSchema();
    const staffId = this.resolveStaffId({}, access);
    const status = ["read", "unread", "archived"].includes(String(payload.status || "")) ? String(payload.status) : "read";
    const row = safeGet(
      `SELECT * FROM staff_notifications WHERE id = @id AND tenantId = @tenantId AND staffId = @staffId`,
      { id, tenantId: access.tenantId, staffId }
    );
    if (!row) throw notFound("Notification not found");
    db.prepare(`UPDATE staff_notifications SET status = @status, updatedAt = @updatedAt WHERE id = @id AND tenantId = @tenantId AND staffId = @staffId`)
      .run({ id, tenantId: access.tenantId, staffId, status, updatedAt: now() });
    const updated = safeGet(`SELECT * FROM staff_notifications WHERE id = @id AND tenantId = @tenantId AND staffId = @staffId`, { id, tenantId: access.tenantId, staffId });
    writeStaffSelfAudit("staff.notification_status", "staff_notifications", id, access, updated?.branchId || row.branchId || "", staffId, { status });
    realtimeService.broadcast("staff-self.notification", { id, status }, { tenantId: access.tenantId, branchId: updated?.branchId || row.branchId || "" });
    return updated;
  }

  updateStaffCalendarItem(id, payload = {}, access) {
    ensureStaffSelfAppSchema();
    const staffId = this.resolveStaffId({}, access);
    const staff = this.getStaff(staffId, access);
    const existing = safeGet(`SELECT * FROM staff_schedules WHERE id = @id AND tenant_id = @tenantId AND staff_id = @staffId`, {
      id,
      tenantId: access.tenantId,
      staffId
    });
    if (!existing) throw notFound("Schedule not found for this staff member");
    const branchId = existing.branch_id || staff.branchId || access.branchId || "";
    const next = {
      id,
      tenantId: access.tenantId,
      staffId,
      branchId,
      scheduleDate: String(payload.scheduleDate || payload.schedule_date || payload.date || existing.schedule_date),
      startTime: String(payload.startTime || payload.start_time || existing.start_time),
      endTime: String(payload.endTime || payload.end_time || existing.end_time),
      status: String(payload.status || existing.status || "scheduled"),
      notes: String(payload.notes ?? existing.notes ?? ""),
      version: Number(existing.version || 1) + 1,
      updatedAt: now()
    };
    if (payload.version !== undefined && Number(payload.version) !== Number(existing.version || 1)) throw badRequest("Schedule was updated by another request");
    if (next.endTime <= next.startTime) throw badRequest("Schedule end time must be after start time");
    const conflict = safeGet(
      `SELECT id FROM staff_schedules
        WHERE tenant_id = @tenantId AND staff_id = @staffId AND branch_id = @branchId
          AND schedule_date = @scheduleDate AND id != @id AND status != 'cancelled'
          AND NOT (@endTime <= start_time OR @startTime >= end_time)
        LIMIT 1`,
      next
    );
    if (conflict) throw badRequest("Schedule overlaps another shift");
    db.prepare(`UPDATE staff_schedules SET schedule_date = @scheduleDate, start_time = @startTime, end_time = @endTime,
      status = @status, notes = @notes, version = @version, updated_at = @updatedAt
      WHERE id = @id AND tenant_id = @tenantId AND staff_id = @staffId`).run(next);
    const updated = safeGet(`SELECT * FROM staff_schedules WHERE id = @id AND tenant_id = @tenantId`, { id, tenantId: access.tenantId });
    writeStaffSelfAudit("staff.schedule_rescheduled", "staff_schedules", id, access, branchId, staffId, next);
    realtimeService.broadcast("staff-self.calendar_updated", { schedule: updated }, { tenantId: access.tenantId, branchId });
    return updated;
  }

  chatThreads(query = {}, access) {
    ensureStaffSelfAppSchema();
    const staffId = this.resolveStaffId(query, access);
    const staff = this.getStaff(staffId, access);
    const branchId = staff.branchId || access.branchId || "branch_hyd";
    const thread = this.ensureBranchThread(access.tenantId, branchId, access.userId || staffId);
    const rows = safeAll(
      `SELECT t.*, COUNT(m.id) AS messageCount, MAX(m.createdAt) AS lastMessageAt
         FROM staffChatThreads t
         LEFT JOIN staffChatMessages m ON m.threadId = t.id AND m.tenantId = t.tenantId AND m.branchId = t.branchId
        WHERE t.tenantId = @tenantId AND t.branchId = @branchId
        GROUP BY t.id
        ORDER BY COALESCE(lastMessageAt, t.updatedAt) DESC`,
      { tenantId: access.tenantId, branchId }
    );
    return rows.length ? rows : [thread];
  }

  chatMessages(threadId, query = {}, access) {
    ensureStaffSelfAppSchema();
    const staffId = this.resolveStaffId(query, access);
    const staff = this.getStaff(staffId, access);
    const branchId = staff.branchId || access.branchId || "branch_hyd";
    const thread = this.ensureBranchThread(access.tenantId, branchId, access.userId || staffId, threadId);
    return safeAll(
      `SELECT * FROM staffChatMessages WHERE tenantId = @tenantId AND branchId = @branchId AND threadId = @threadId ORDER BY createdAt ASC LIMIT 200`,
      { tenantId: access.tenantId, branchId, threadId: thread.id }
    );
  }

  sendChatMessage(payload = {}, access) {
    ensureStaffSelfAppSchema();
    const staffId = this.resolveStaffId({}, access);
    const staff = this.getStaff(staffId, access);
    const branchId = staff.branchId || access.branchId || "branch_hyd";
    const thread = this.ensureBranchThread(access.tenantId, branchId, access.userId || staffId, payload.threadId || payload.thread_id || "");
    const body = String(payload.body || payload.message || "").trim();
    if (!body) throw badRequest("Message body is required");
    const row = {
      id: makeId("msg"),
      tenantId: access.tenantId,
      branchId,
      threadId: thread.id,
      senderStaffId: staffId,
      senderName: staff.fullName || access.loginId || "Staff",
      body,
      createdAt: now(),
      readByJson: JSON.stringify([staffId])
    };
    db.prepare(`INSERT INTO staffChatMessages (id, tenantId, branchId, threadId, senderStaffId, senderName, body, createdAt, readByJson)
      VALUES (@id, @tenantId, @branchId, @threadId, @senderStaffId, @senderName, @body, @createdAt, @readByJson)`).run(row);
    db.prepare(`UPDATE staffChatThreads SET updatedAt = @updatedAt WHERE id = @threadId AND tenantId = @tenantId AND branchId = @branchId`)
      .run({ updatedAt: row.createdAt, threadId: thread.id, tenantId: access.tenantId, branchId });
    writeStaffSelfAudit("staff.chat_message_sent", "staffChatMessages", row.id, access, branchId, staffId, { threadId: thread.id });
    realtimeService.broadcast("staff-self.chat_message", { message: row }, { tenantId: access.tenantId, branchId });
    return row;
  }

  learning(query = {}, access) {
    ensureStaffSelfAppSchema();
    const staffId = this.resolveStaffId(query, access);
    const staff = this.getStaff(staffId, access);
    const branchId = staff.branchId || access.branchId || "branch_hyd";
    this.ensureLearningModules(access.tenantId, branchId);
    const modules = safeAll(
      `SELECT m.*, COALESCE(p.status, 'open') AS progressStatus, COALESCE(p.completedAt, '') AS completedAt
         FROM staffLearningModules m
         LEFT JOIN staffLearningProgress p ON p.moduleId = m.id AND p.staffId = @staffId AND p.tenantId = m.tenantId AND p.branchId = m.branchId
        WHERE m.tenantId = @tenantId AND m.branchId = @branchId AND m.status = 'active'
        ORDER BY m.createdAt ASC`,
      { tenantId: access.tenantId, branchId, staffId }
    );
    const completed = modules.filter((item) => item.progressStatus === "completed").length;
    return { modules, summary: { total: modules.length, completed, progress: modules.length ? Math.round((completed / modules.length) * 100) : 0 } };
  }

  completeLearningModule(moduleId, payload = {}, access) {
    ensureStaffSelfAppSchema();
    const staffId = this.resolveStaffId({}, access);
    const staff = this.getStaff(staffId, access);
    const branchId = staff.branchId || access.branchId || "branch_hyd";
    this.ensureLearningModules(access.tenantId, branchId);
    const module = safeGet(`SELECT * FROM staffLearningModules WHERE id = @moduleId AND tenantId = @tenantId AND branchId = @branchId`, {
      moduleId,
      tenantId: access.tenantId,
      branchId
    });
    if (!module) throw notFound("Learning module not found");
    const status = String(payload.status || "completed");
    const row = {
      id: makeId("learn"),
      tenantId: access.tenantId,
      branchId,
      staffId,
      moduleId,
      status,
      completedAt: status === "completed" ? now() : "",
      updatedAt: now()
    };
    db.prepare(`INSERT INTO staffLearningProgress (id, tenantId, branchId, staffId, moduleId, status, completedAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @staffId, @moduleId, @status, @completedAt, @updatedAt)
      ON CONFLICT(tenantId, branchId, staffId, moduleId) DO UPDATE SET status = excluded.status, completedAt = excluded.completedAt, updatedAt = excluded.updatedAt`).run(row);
    writeStaffSelfAudit("staff.learning_progress", "staffLearningModules", moduleId, access, branchId, staffId, { status });
    realtimeService.broadcast("staff-self.learning_progress", { moduleId, status, staffId }, { tenantId: access.tenantId, branchId });
    return this.learning({}, access);
  }

  ensureBranchThread(tenantId, branchId, createdBy = "", requestedThreadId = "") {
    const existing = requestedThreadId
      ? safeGet(`SELECT * FROM staffChatThreads WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId`, { id: requestedThreadId, tenantId, branchId })
      : safeGet(`SELECT * FROM staffChatThreads WHERE tenantId = @tenantId AND branchId = @branchId AND channel = 'branch' ORDER BY createdAt ASC LIMIT 1`, { tenantId, branchId });
    if (existing) return existing;
    const row = {
      id: makeId("thread"),
      tenantId,
      branchId,
      title: "Branch Team Chat",
      channel: "branch",
      createdBy,
      createdAt: now(),
      updatedAt: now()
    };
    db.prepare(`INSERT INTO staffChatThreads (id, tenantId, branchId, title, channel, createdBy, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @title, @channel, @createdBy, @createdAt, @updatedAt)`).run(row);
    return row;
  }

  ensureLearningModules(tenantId, branchId) {
    const existing = safeGet(`SELECT id FROM staffLearningModules WHERE tenantId = @tenantId AND branchId = @branchId LIMIT 1`, { tenantId, branchId });
    if (existing) return;
    const stamp = now();
    const modules = [
      { id: makeId("module"), tenantId, branchId, title: "Premium Consultation Flow", description: "Client greeting, preference capture and consultation notes.", category: "client", durationMinutes: 12, status: "active", createdAt: stamp, updatedAt: stamp },
      { id: makeId("module"), tenantId, branchId, title: "Add-on Recommendation Basics", description: "Use service context to suggest relevant add-ons without overselling.", category: "sales", durationMinutes: 9, status: "active", createdAt: stamp, updatedAt: stamp },
      { id: makeId("module"), tenantId, branchId, title: "Checkout Handoff", description: "Review summary, payment handoff and rebooking reminder.", category: "operations", durationMinutes: 8, status: "active", createdAt: stamp, updatedAt: stamp }
    ];
    const insert = db.prepare(`INSERT INTO staffLearningModules (id, tenantId, branchId, title, description, category, durationMinutes, status, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @title, @description, @category, @durationMinutes, @status, @createdAt, @updatedAt)`);
    modules.forEach((module) => insert.run(module));
  }

  clientSpendMap(tenantId, clientIds = []) {
    const ids = [...new Set(clientIds.filter(Boolean))];
    const spend = new Map();
    if (!ids.length) return spend;
    const idParams = Object.fromEntries(ids.map((id, index) => [`client${index}`, id]));
    const filters = [`clientId IN (${ids.map((_, index) => `@client${index}`).join(", ")})`];
    if (columnsFor("sales").includes("tenantId")) filters.push("tenantId = @tenantId");
    const rows = safeAll(`SELECT clientId, SUM(total) AS total FROM sales WHERE ${filters.join(" AND ")} GROUP BY clientId`, {
      tenantId,
      ...idParams
    });
    rows.forEach((row) => spend.set(row.clientId, number(row.total)));
    return spend;
  }

  birthdayClients(tenantId, clientIds = [], date = "") {
    const ids = [...new Set(clientIds.filter(Boolean))];
    const columns = columnsFor("clients");
    if (!ids.length || !columns.includes("birthday")) return [];
    const idParams = Object.fromEntries(ids.map((id, index) => [`client${index}`, id]));
    const filters = [`id IN (${ids.map((_, index) => `@client${index}`).join(", ")})`, "substr(birthday, 6, 5) = @monthDay"];
    if (columns.includes("tenantId")) filters.push("tenantId = @tenantId");
    const phoneColumn = columns.includes("phone") ? "phone" : "'' AS phone";
    const rows = safeAll(`SELECT id, name, birthday, ${phoneColumn} FROM clients WHERE ${filters.join(" AND ")} LIMIT 20`, {
      tenantId,
      monthDay: String(date || "").slice(5, 10),
      ...idParams
    });
    return rows.map((row) => ({ id: row.id, name: row.name || row.id, phone: row.phone || "", birthday: row.birthday || "" }));
  }

  pendingPayments(tenantId, clientIds = []) {
    const ids = [...new Set(clientIds.filter(Boolean))];
    const columns = columnsFor("invoices");
    if (!ids.length || !columns.includes("clientId") || !columns.includes("balance")) return [];
    const idParams = Object.fromEntries(ids.map((id, index) => [`client${index}`, id]));
    const filters = [`clientId IN (${ids.map((_, index) => `@client${index}`).join(", ")})`, "balance > 0"];
    if (columns.includes("tenantId")) filters.push("tenantId = @tenantId");
    return safeAll(`SELECT id, clientId, invoiceNumber, balance, dueDate, status FROM invoices WHERE ${filters.join(" AND ")} ORDER BY dueDate ASC LIMIT 20`, {
      tenantId,
      ...idParams
    }).map((row) => ({
      id: row.id,
      clientId: row.clientId,
      invoiceNumber: row.invoiceNumber || row.id,
      balance: number(row.balance),
      dueDate: row.dueDate || "",
      status: row.status || "unpaid"
    }));
  }

  targetProgress(rows = [], expectedRevenue = 0) {
    const target = rows.find((row) => String(row.target_type || row.targetType || "").toLowerCase().includes("revenue")) || rows[0] || null;
    const hasTarget = rows.length > 0 && target != null;
    const targetValue = hasTarget ? number(target.target_value ?? target.targetValue ?? 0) : 0;
    const achievedValue = hasTarget ? number(target.achieved_value ?? target.achievedValue ?? 0) : 0;
    return {
      label: target?.target_name || target?.targetName || target?.target_type || target?.targetType || "Today revenue",
      targetValue: hasTarget ? targetValue : expectedRevenue,
      achievedValue: hasTarget ? achievedValue : 0,
      percentage: hasTarget && targetValue ? pct((achievedValue / targetValue) * 100) : 0,
      remaining: hasTarget ? Math.max(0, targetValue - achievedValue) : expectedRevenue
    };
  }

  busiestHour(appointments = []) {
    const counts = new Map();
    for (const item of appointments) {
      const start = new Date(item.startAt || "");
      if (Number.isNaN(start.getTime())) continue;
      const hour = start.getHours();
      counts.set(hour, (counts.get(hour) || 0) + 1);
    }
    const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return busiest ? { hour: busiest[0], label: hourLabel(busiest[0]), count: busiest[1] } : null;
  }

  isLateAppointment(item = {}, nowDate = new Date()) {
    const status = String(item.status || "").toLowerCase();
    if (["completed", "checked-out", "cancelled", "no-show"].includes(status)) return false;
    const start = new Date(item.startAt || "");
    return !Number.isNaN(start.getTime()) && nowDate.getTime() - start.getTime() > 10 * 60000;
  }

  staffCoachCards({ dashboard, revenueMore, vipClients, pendingPayments, targetProgress, busiestHour }) {
    const cards = [
      {
        priority: "high",
        title: "Morning summary",
        body: `${dashboard.todayAppointments.length} appointments, ${dashboard.summary.liveAppointments} live, ${dashboard.summary.completedAppointments} completed recently.`,
        action: "Open the first booking and confirm service notes."
      }
    ];
    if (revenueMore > 0) {
      cards.push({ priority: "medium", title: "Target coach", body: `${targetProgress.percentage}% target progress. Need ${revenueMore} more to close the gap.`, action: "Recommend one relevant add-on during consultation." });
    }
    if (vipClients.length) {
      cards.push({ priority: "high", title: "VIP prep", body: `${vipClients.length} high-value client signal found today.`, action: "Review preferences before check-in." });
    }
    if (pendingPayments.length) {
      cards.push({ priority: "medium", title: "Payment reminder", body: `${pendingPayments.length} client invoice balance is pending.`, action: "Ask front desk to reconcile before checkout." });
    }
    if (busiestHour) {
      cards.push({ priority: "low", title: "Peak hour", body: `${busiestHour.label} has ${busiestHour.count} appointment${busiestHour.count === 1 ? "" : "s"}.`, action: "Keep consultation and room setup ready." });
    }
    if (cards.length === 1) {
      cards.push({ priority: "low", title: "No risk flags", body: "Schedule looks stable from connected records.", action: "Focus on premium client experience." });
    }
    return cards;
  }

  timelineItem(item = {}, nowDate = new Date()) {
    const start = new Date(item.startAt || "");
    const end = new Date(item.endAt || "");
    const minutesToStart = Number.isNaN(start.getTime()) ? 0 : Math.round((start.getTime() - nowDate.getTime()) / 60000);
    const status = String(item.status || "booked").toLowerCase();
    return {
      id: item.id,
      clientId: item.clientId,
      clientName: item.clientName || "Walk-in client",
      serviceNames: item.serviceNames || [],
      startAt: item.startAt,
      endAt: item.endAt,
      chair: item.chair || "",
      status,
      minutesToStart,
      state: this.isLateAppointment(item, nowDate) ? "late" : status.includes("service") || status.includes("started") ? "active" : minutesToStart <= 15 && minutesToStart >= 0 ? "soon" : "planned",
      durationMinutes: Number.isNaN(end.getTime()) || Number.isNaN(start.getTime()) ? number(item.durationMinutes) : Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
    };
  }

  serviceTimer(item = {}, nowDate = new Date()) {
    const start = new Date(item.startAt || "");
    const end = new Date(item.endAt || "");
    const elapsedMinutes = Number.isNaN(start.getTime()) ? 0 : Math.max(0, Math.round((nowDate.getTime() - start.getTime()) / 60000));
    const totalMinutes = Number.isNaN(end.getTime()) || Number.isNaN(start.getTime()) ? number(item.durationMinutes) : Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    return {
      appointmentId: item.id,
      clientName: item.clientName || "Client",
      status: item.status || "booked",
      elapsedMinutes,
      totalMinutes,
      remainingMinutes: Math.max(0, totalMinutes - elapsedMinutes),
      progress: totalMinutes ? pct((elapsedMinutes / totalMinutes) * 100) : 0
    };
  }

  performanceIntelligence(dashboard, rows = []) {
    const revenue = rows.length
      ? rows.reduce((sum, row) => sum + number(row.revenue_generated || row.revenueGenerated), 0)
      : dashboard.summary.revenue || 0;
    const completedServices = rows.length
      ? rows.reduce((sum, row) => sum + number(row.completed_services || row.completedServices), 0)
      : dashboard.summary.completedAppointments || 0;
    const avgUtilization = rows.length ? rows.reduce((sum, row) => sum + number(row.utilization_pct || row.utilizationPct), 0) / rows.length : 0;
    const avgRating = rows.length ? rows.reduce((sum, row) => sum + number(row.avg_rating || row.avgRating), 0) / rows.length : 0;
    const productivityScore = rows.length ? rows.reduce((sum, row) => sum + number(row.productivity_score || row.productivityScore), 0) / rows.length : Math.min(100, completedServices * 10);
    const strengths = [];
    const opportunities = [];
    if (completedServices > 0) strengths.push("Completed service history is connected.");
    if (avgRating >= 4.5) strengths.push("Review quality is strong.");
    if (dashboard.summary.cancelledAppointments > 0) opportunities.push("Reduce cancellation/no-show leakage with pre-visit confirmations.");
    if (avgUtilization < 55) opportunities.push("Utilization can improve with smart add-ons or walk-in allocation.");
    return {
      revenue,
      completedServices,
      avgUtilization: Math.round(avgUtilization),
      avgRating: Number(avgRating.toFixed(1)),
      productivityScore: Math.round(productivityScore),
      strengths: strengths.length ? strengths : ["Connected staff data is ready for coaching."],
      opportunities: opportunities.length ? opportunities : ["Maintain pace and request reviews after premium services."]
    };
  }

  leaderboard(rows = [], staffId = "", tenantId = "") {
    const names = this.staffNameMap(tenantId, rows.map((row) => row.staff_id || row.staffId).filter(Boolean));
    const list = rows.map((row, index) => {
      const id = row.staff_id || row.staffId || staffId;
      return {
        rank: index + 1,
        staffId: id,
        staffName: names.get(id) || id,
        revenue: number(row.revenue || row.revenueGenerated),
        score: Math.round(number(row.score || row.avgScore || row.productivity_score)),
        rating: Number(number(row.rating || row.avgRating).toFixed(1)),
        days: number(row.days),
        isMe: id === staffId
      };
    });
    return list.length ? list : [{ rank: 1, staffId, staffName: names.get(staffId) || staffId, revenue: 0, score: 0, rating: 0, days: 0, isMe: true }];
  }

  staffNameMap(tenantId = "", staffIds = []) {
    const ids = [...new Set(staffIds.filter(Boolean))];
    const names = new Map();
    if (!ids.length) return names;
    const idParams = Object.fromEntries(ids.map((id, index) => [`staff${index}`, id]));
    const tenantFilter = tenantId ? " AND tenant_id = @tenantId" : "";
    const rows = safeAll(`SELECT id, full_name FROM staff_master WHERE id IN (${ids.map((_, index) => `@staff${index}`).join(", ")})${tenantFilter}`, {
      tenantId,
      ...idParams
    });
    rows.forEach((row) => names.set(row.id, row.full_name || row.id));
    return names;
  }

  badges({ dashboard, points, targetProgress }) {
    return [
      { label: "Service Finisher", description: "Completed at least one assigned service", earned: dashboard.summary.completedAppointments > 0 },
      { label: "Revenue Mover", description: "Crossed 75% of active target", earned: targetProgress.percentage >= 75 },
      { label: "Client Favorite", description: "Built from review and repeat-visit signals", earned: points >= 250 },
      { label: "Zero Leakage", description: "No cancellations in the current window", earned: dashboard.summary.cancelledAppointments === 0 }
    ];
  }

  performanceWindow(rows = [], days = 1) {
    const slice = rows.slice(0, days);
    return {
      days: slice.length,
      revenue: slice.reduce((sum, row) => sum + number(row.revenue_generated || row.revenueGenerated), 0),
      services: slice.reduce((sum, row) => sum + number(row.completed_services || row.completedServices), 0),
      productivityScore: slice.length ? Math.round(slice.reduce((sum, row) => sum + number(row.productivity_score || row.productivityScore), 0) / slice.length) : 0,
      rating: slice.length ? Number((slice.reduce((sum, row) => sum + number(row.avg_rating || row.avgRating), 0) / slice.length).toFixed(1)) : 0
    };
  }

  clientRecord(tenantId, branchId, clientId) {
    const columns = columnsFor("clients");
    const filters = ["id = @clientId"];
    if (columns.includes("tenantId")) filters.push("tenantId = @tenantId");
    if (columns.includes("branchId") && branchId) filters.push("branchId = @branchId");
    return safeGet(`SELECT * FROM clients WHERE ${filters.join(" AND ")} LIMIT 1`, { tenantId, branchId, clientId });
  }

  clientMedia(tenantId, branchId, clientId) {
    ensureStaffSelfAppSchema();
    const rows = safeAll(
      `SELECT * FROM staffClientMedia WHERE tenantId = @tenantId AND branchId = @branchId AND clientId = @clientId ORDER BY createdAt DESC LIMIT 24`,
      { tenantId, branchId, clientId }
    );
    if (rows.length) return rows;
    return [{
      id: `media_${clientId}_placeholder`,
      tenantId,
      branchId,
      clientId,
      title: "Portfolio media can be attached after service completion",
      type: "placeholder",
      url: "",
      createdAt: ""
    }];
  }

  clientAppointments(tenantId, branchId, clientId) {
    const columns = columnsFor("appointments");
    const filters = ["clientId = @clientId"];
    if (columns.includes("tenantId")) filters.push("tenantId = @tenantId");
    if (columns.includes("branchId") && branchId) filters.push("branchId = @branchId");
    return safeAll(`SELECT * FROM appointments WHERE ${filters.join(" AND ")} ORDER BY startAt DESC LIMIT 30`, { tenantId, branchId, clientId });
  }

  clientSales(tenantId, branchId, clientId) {
    const columns = columnsFor("sales");
    const filters = ["clientId = @clientId"];
    if (columns.includes("tenantId")) filters.push("tenantId = @tenantId");
    if (columns.includes("branchId") && branchId) filters.push("branchId = @branchId");
    return safeAll(`SELECT * FROM sales WHERE ${filters.join(" AND ")} ORDER BY createdAt DESC LIMIT 30`, { tenantId, branchId, clientId });
  }

  clientRecommendations({ appointments = [], sales = [], lifetimeSpend = 0, retentionScore = 0 }) {
    const recommendations = [];
    if (lifetimeSpend > 25000) recommendations.push("Treat as VIP: confirm preferences and suggest a premium add-on only if relevant.");
    if (appointments.length >= 3) recommendations.push("Use previous service history before consultation.");
    if (sales.length === 0) recommendations.push("No purchase history found; keep recommendations service-led.");
    if (retentionScore < 45) recommendations.push("Retention risk: invite feedback and offer a next-visit reminder.");
    return recommendations.length ? recommendations : ["Continue with standard Aura premium consultation flow."];
  }

  resolveStaffId(query = {}, access = {}) {
    const requestedStaffId = String(query.staffId || query.staff_id || "").trim();
    const user = access.userId
      ? db.prepare("SELECT staffId FROM tenant_users WHERE id = ? AND tenantId = ?").get(access.userId, access.tenantId)
      : null;
    const staffId = String(access.staffId || user?.staffId || "").trim();
    if (staffId) {
      if (requestedStaffId && requestedStaffId !== staffId) throw forbidden("Staff can view only their own work");
      return staffId;
    }
    const role = normalizeRole(access.role);
    if (requestedStaffId && privilegedRoles.has(role)) return requestedStaffId;
    if (!requestedStaffId && privilegedRoles.has(role)) {
      const defaultStaff = this.defaultStaffForManager(access);
      if (defaultStaff?.id) return defaultStaff.id;
    }
    throw forbidden("This login is not linked with a staff profile");
  }

  defaultStaffForManager(access = {}) {
    const branchId = String(access.branchId || "").trim();
    const baseSql = `SELECT id FROM staff_master
      WHERE tenant_id = @tenantId
        AND COALESCE(status, 'active') NOT IN ('archived', 'blocked', 'deleted', 'inactive', 'suspended', 'terminated')`;
    if (branchId) {
      const branchRow = db.prepare(`${baseSql} AND branch_id = @branchId ORDER BY full_name ASC LIMIT 1`).get({
        tenantId: access.tenantId,
        branchId
      });
      if (branchRow?.id) return branchRow;
    }
    const staffMasterRow = db.prepare(`${baseSql} ORDER BY full_name ASC LIMIT 1`).get({ tenantId: access.tenantId });
    if (staffMasterRow?.id) return staffMasterRow;
    const legacyBranchFilter = branchId ? " AND branchId = @branchId" : "";
    return db.prepare(`SELECT id FROM staff WHERE tenantId = @tenantId${legacyBranchFilter} ORDER BY name ASC LIMIT 1`).get({ tenantId: access.tenantId, branchId }) || null;
  }

  getStaff(staffId, access) {
    const row = db.prepare("SELECT * FROM staff_master WHERE id = ? AND tenant_id = ?").get(staffId, access.tenantId);
    if (!row) {
      const legacy = db.prepare("SELECT * FROM staff WHERE id = ? AND tenantId = ?").get(staffId, access.tenantId);
      if (!legacy) throw notFound("Staff record not found");
      if (!privilegedRoles.has(normalizeRole(access.role)) && access.branchId && legacy.branchId !== access.branchId) {
        throw forbidden("This staff record is outside your branch access");
      }
      return legacyRowToStaff(legacy);
    }
    if (!privilegedRoles.has(normalizeRole(access.role)) && access.branchId && row.branch_id !== access.branchId) {
      throw forbidden("This staff record is outside your branch access");
    }
    return rowToStaff(row);
  }

  staffIdentityIds(staff, tenantId) {
    const ids = new Set([staff.id].filter(Boolean));
    const clauses = ["id = @id"];
    const params = { id: staff.id };
    if (staff.email) {
      clauses.push("lower(email) = lower(@email)");
      params.email = staff.email;
    }
    if (staff.mobile) {
      clauses.push("phone = @mobile");
      params.mobile = staff.mobile;
    }
    if (staff.fullName) {
      clauses.push("lower(name) = lower(@name)");
      params.name = staff.fullName;
    }
    const matches = db.prepare(`SELECT id FROM staff WHERE ${clauses.join(" OR ")}`).all(params);
    matches.forEach((row) => ids.add(row.id));
    const linkedUsers = db.prepare("SELECT staffId FROM tenant_users WHERE tenantId = ? AND staffId = ?").all(tenantId, staff.id);
    linkedUsers.forEach((row) => row.staffId && ids.add(row.staffId));
    return [...ids].filter(Boolean);
  }

  enrichAppointments(rows, tenantId = "") {
    const clientColumns = columnsFor("clients");
    const clientSelect = ["id", "name", clientColumns.includes("phone") ? "phone" : "'' AS phone"];
    clientSelect.push(clientColumns.includes("mobile") ? "mobile" : "'' AS mobile");
    const clientRows = clientColumns.includes("tenantId") && tenantId
      ? db.prepare(`SELECT ${clientSelect.join(", ")} FROM clients WHERE tenantId = ?`).all(tenantId)
      : db.prepare(`SELECT ${clientSelect.join(", ")} FROM clients`).all();
    const clients = new Map(clientRows.map((row) => [row.id, row]));
    const services = new Map(db.prepare("SELECT id, name, durationMinutes, price FROM services").all().map((row) => [row.id, row]));
    return rows.map((row) => {
      const serviceIds = parseServiceIds(row.serviceIds);
      const serviceRows = serviceIds.map((serviceId) => services.get(serviceId)).filter(Boolean);
      const client = clients.get(row.clientId);
      const serviceValue = serviceRows.reduce((sum, service) => sum + Number(service.price || 0), 0);
      return {
        id: row.id,
        clientId: row.clientId,
        clientName: client?.name || row.clientId,
        clientPhone: client?.phone || client?.mobile || "",
        staffId: row.staffId,
        branchId: row.branchId,
        serviceIds,
        serviceNames: serviceRows.map((service) => service.name),
        durationMinutes: serviceRows.reduce((sum, service) => sum + Number(service.durationMinutes || 0), 0),
        value: appointmentValue(row) || serviceValue,
        startAt: row.startAt,
        endAt: row.endAt,
        status: row.status,
        chair: row.chair || row.room || "",
        source: row.source || "",
        notes: row.notes || ""
      };
    });
  }
}

export const staffLoginService = new StaffLoginService();
