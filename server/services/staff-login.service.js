import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { columnsFor, db } from "../db.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;
const privilegedRoles = new Set(["superAdmin", "owner", "admin", "manager"]);

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
  return String(value || "").trim().toLowerCase();
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
    return `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallbackDate : date.toISOString();
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
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
    const staff = typeof staffOrId === "string" ? this.getStaff(staffOrId, access) : staffOrId;
    if (!staff?.id) throw notFound("Staff record not found");
    if (!privilegedRoles.has(access.role)) throw forbidden("Only managers and admins can provision staff login");
    const loginId = normalizeLoginId(payload.loginId || payload.login_id || payload.email || staff.email || staff.mobile || staff.id);
    if (!loginId) throw badRequest("Staff login ID is required");
    const email = safeEmail(loginId, payload.email || staff.email);
    const requestedRole = String(payload.role || payload.roleId || staff.roleId || "staff").trim();
    const authRole = ["manager", "frontDesk", "cashier", "staff"].includes(requestedRole) ? requestedRole : "staff";
    const branchIds = [staff.branchId].filter(Boolean);
    const existingByStaff = db.prepare("SELECT * FROM tenant_users WHERE tenantId = ? AND staffId = ?").get(access.tenantId, staff.id);
    const existingByLogin = db.prepare(`SELECT * FROM tenant_users
      WHERE tenantId = ? AND (lower(loginId) = lower(?) OR lower(email) = lower(?))`)
      .get(access.tenantId, loginId, email);
    const existing = existingByStaff || existingByLogin;
    if (existingByLogin && existingByLogin.staffId && existingByLogin.staffId !== staff.id) {
      throw badRequest("This login ID is already linked to another staff member");
    }
    if (!existing && !payload.password) throw badRequest("Password is required when creating staff login");
    const passwordPatch = payload.password ? hashPassword(payload.password) : {
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
      status: payload.status || existing?.status || "active",
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    if (existing) {
      db.prepare(`UPDATE tenant_users SET
        name = @name, loginId = @loginId, email = @email, role = @role, branchIds = @branchIds,
        staffId = @staffId, passwordSalt = @passwordSalt, passwordHash = @passwordHash,
        failedLoginCount = @failedLoginCount, lockedUntil = @lockedUntil, status = @status,
        updatedAt = @updatedAt
        WHERE id = @id AND tenantId = @tenantId`).run(row);
    } else {
      db.prepare(`INSERT INTO tenant_users (
        id, tenantId, name, loginId, email, role, branchIds, staffId, passwordSalt, passwordHash,
        failedLoginCount, lockedUntil, lastLoginAt, status, createdAt, updatedAt
      ) VALUES (
        @id, @tenantId, @name, @loginId, @email, @role, @branchIds, @staffId, @passwordSalt, @passwordHash,
        @failedLoginCount, @lockedUntil, @lastLoginAt, @status, @createdAt, @updatedAt
      )`).run(row);
    }
    return rowToAuthUser(db.prepare("SELECT * FROM tenant_users WHERE id = ? AND tenantId = ?").get(row.id, access.tenantId));
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
    const todayText = new Date().toISOString().slice(0, 10);
    const from = toIsoBoundary(query.from, new Date(Date.now() - 30 * 86400000).toISOString());
    const to = toIsoBoundary(query.to, new Date(Date.now() + 30 * 86400000).toISOString(), true);
    const todayStart = `${String(query.date || todayText).slice(0, 10)}T00:00:00.000Z`;
    const todayEndDate = new Date(todayStart);
    todayEndDate.setUTCDate(todayEndDate.getUTCDate() + 1);
    const todayEnd = todayEndDate.toISOString();
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
      range: { from, to, date: String(query.date || todayText).slice(0, 10) },
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

  resolveStaffId(query = {}, access = {}) {
    const requestedStaffId = String(query.staffId || query.staff_id || "").trim();
    if (requestedStaffId && privilegedRoles.has(access.role)) return requestedStaffId;
    if (!requestedStaffId && privilegedRoles.has(access.role)) {
      const defaultStaff = this.defaultStaffForManager(access);
      if (defaultStaff?.id) return defaultStaff.id;
    }
    const user = access.userId
      ? db.prepare("SELECT staffId FROM tenant_users WHERE id = ? AND tenantId = ?").get(access.userId, access.tenantId)
      : null;
    const staffId = String(access.staffId || user?.staffId || "").trim();
    if (!staffId) throw forbidden("This login is not linked with a staff profile");
    if (requestedStaffId && requestedStaffId !== staffId) throw forbidden("Staff can view only their own work");
    return staffId;
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
    return db.prepare(`${baseSql} ORDER BY full_name ASC LIMIT 1`).get({ tenantId: access.tenantId }) || null;
  }

  getStaff(staffId, access) {
    const row = db.prepare("SELECT * FROM staff_master WHERE id = ? AND tenant_id = ?").get(staffId, access.tenantId);
    if (!row) throw notFound("Staff record not found");
    if (!privilegedRoles.has(access.role) && access.branchId && row.branch_id !== access.branchId) {
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
