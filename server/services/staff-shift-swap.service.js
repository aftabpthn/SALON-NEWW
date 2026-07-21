import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { isOwnerControlRole } from "./access-control.service.js";
import { realtimeService } from "./realtime.service.js";
import { staffWebPushService } from "./staff-web-push.service.js";
import { tenantService } from "./tenant.service.js";

const managerRoles = new Set(["owner", "admin", "superadmin", "manager"]);
const ownerControlRoles = new Set(["owner", "admin", "superadmin"]);
const terminalStatuses = new Set(["approved", "rejected", "declined", "cancelled"]);
const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

function selfStaffId(access = {}) {
  const direct = String(access.staffId || "").trim();
  if (direct) return direct;
  return String(db.prepare(`SELECT staffId FROM tenant_users WHERE id = @userId AND tenantId = @tenantId`)
    .get({ userId: access.userId || "", tenantId: access.tenantId || "" })?.staffId || "");
}

function requireManager(access = {}) {
  if (!managerRoles.has(String(access.role || "").toLowerCase())) throw forbidden("Manager access is required");
}

function requireOwnerControl(access = {}) {
  if (!isOwnerControlRole(access.role)) throw forbidden("Owner, admin or super admin approval is required");
}

function businessDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function overlaps(left, right) {
  const expand = (row) => {
    const start = Date.parse(`${row.schedule_date}T${row.start_time}:00+05:30`);
    let end = Date.parse(`${row.schedule_date}T${row.end_time}:00+05:30`);
    if (end <= start) end += 24 * 60 * 60000;
    return { start, end };
  };
  const a = expand(left);
  const b = expand(right);
  return a.start < b.end && a.end > b.start;
}

function shiftEnded(schedule) {
  const start = Date.parse(`${schedule.schedule_date}T${schedule.start_time}:00+05:30`);
  let end = Date.parse(`${schedule.schedule_date}T${schedule.end_time}:00+05:30`);
  if (end <= start) end += 24 * 60 * 60000;
  return Date.now() >= end;
}

function camel(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
}

function enrichedRows(where, params, limit = 100) {
  return db.prepare(`SELECT sw.*, COALESCE(s.schedule_date, sw.requested_schedule_date) AS schedule_date,
      COALESCE(s.start_time, sw.requested_start_time) AS start_time,
      COALESCE(s.end_time, sw.requested_end_time) AS end_time,
      COALESCE(s.shift_type, sw.requested_shift_type) AS shift_type,
      fs.full_name AS from_staff_name, ts.full_name AS to_staff_name
    FROM staff_shift_swaps sw
    LEFT JOIN staff_schedules s ON s.id = sw.schedule_id AND s.tenant_id = sw.tenant_id
    LEFT JOIN staff_master fs ON fs.id = sw.from_staff_id AND fs.tenant_id = sw.tenant_id
    LEFT JOIN staff_master ts ON ts.id = sw.to_staff_id AND ts.tenant_id = sw.tenant_id
    WHERE ${where} ORDER BY CASE WHEN sw.status IN ('pending_staff', 'pending_manager') THEN 0 ELSE 1 END, sw.created_at DESC LIMIT @limit`)
    .all({ ...params, limit }).map(camel);
}

function notification({ tenantId, branchId, staffId, type, title, body, swapId }) {
  if (!staffId) return;
  try {
    const stamp = now();
    const row = {
      id: makeId("staff_note"), tenantId, branchId, staffId, type, channel: "app", title, body,
      status: "unread", payload: JSON.stringify({ shiftSwapId: swapId, url: "/staff/roster" }),
      copiedAt: "", approvedAt: "", createdAt: stamp, updatedAt: stamp
    };
    db.prepare(`INSERT INTO staff_notifications
      (id, tenantId, branchId, staffId, type, channel, title, body, status, payload, copiedAt, approvedAt, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @staffId, @type, @channel, @title, @body, @status, @payload, @copiedAt, @approvedAt, @createdAt, @updatedAt)`).run(row);
    staffWebPushService.queueStaffNotification(row);
  } catch {
    // Notification delivery must never roll back an already-saved swap transition.
  }
}

function broadcast(type, swap) {
  try {
    realtimeService.broadcast(type, { id: swap.id, status: swap.status, scheduleId: swap.schedule_id }, {
      tenantId: swap.tenant_id, branchId: swap.branch_id, channel: `branch:${swap.branch_id}`
    });
  } catch {
    // Realtime publication is best-effort after the durable transition commits.
  }
}

function notifyOwnersForApproval(swap, message = "A coworker accepted a shift swap. Review and approve or reject it.") {
  const title = "Shift swap needs approval";
  const payload = { type: "shift_swap_pending_approval", shiftSwapId: swap.id, scheduleId: swap.schedule_id, url: "/staff/roster" };
  let ownerUserIds = [];
  try {
    repositories.notifications.create({
      id: `owner_shift_swap_${swap.id}`,
      clientId: "",
      type: "shift_swap_pending_approval",
      channel: "app",
      message: `${title}: ${message}`,
      status: "pending-action"
    }, { tenantId: swap.tenant_id, branchId: swap.branch_id });
  } catch {
    // The owner feed notification is best-effort and idempotent by its deterministic id.
  }
  try {
    ownerUserIds = repositories.tenantUsers.list({ limit: 1000 }, { tenantId: swap.tenant_id })
      .filter((user) => isOwnerControlRole(user.role) && user.status !== "inactive")
      .map((user) => user.id);
  } catch {
    // Recipient discovery must not affect the saved swap transition.
  }
  for (const userId of ownerUserIds) {
    try {
      repositories.pushNotifications.create({
        id: `push_shift_swap_${swap.id}_${userId}`,
        userId,
        branchId: swap.branch_id,
        deviceId: "",
        title,
        message,
        payload,
        status: "queued",
        providerMessageId: "",
        sentAt: ""
      }, { tenantId: swap.tenant_id, branchId: swap.branch_id });
    } catch {
      // A retry may find an already-enqueued per-user notification.
    }
  }
  try {
    realtimeService.sendToUsers("owner:shift_swap_pending_approval", payload, {
      tenantId: swap.tenant_id,
      branchId: swap.branch_id,
      userIds: ownerUserIds
    });
    realtimeService.broadcast("owner:shift_swap_pending_approval", payload, {
      tenantId: swap.tenant_id,
      branchId: swap.branch_id,
      channel: `branch:${swap.branch_id}`
    });
  } catch {
    // Realtime publication is best-effort after notification enqueue.
  }
}

function targetConflict(schedule, targetStaffId, tenantId) {
  const rows = db.prepare(`SELECT id, schedule_date, start_time, end_time FROM staff_schedules
    WHERE tenant_id = @tenantId AND branch_id = @branchId AND staff_id = @staffId
      AND schedule_date BETWEEN @fromDate AND @toDate AND status != 'cancelled' AND id != @scheduleId`)
    .all({ tenantId, branchId: schedule.branch_id, staffId: targetStaffId, fromDate: addDays(schedule.schedule_date, -1), toDate: addDays(schedule.schedule_date, 1), scheduleId: schedule.id });
  return rows.some((row) => overlaps(schedule, row));
}

function loadSwap(id, tenantId) {
  const row = db.prepare(`SELECT * FROM staff_shift_swaps WHERE id = @id AND tenant_id = @tenantId`).get({ id, tenantId });
  if (!row) throw notFound("Shift swap not found");
  return row;
}

function assertVersion(row, value) {
  if (value !== undefined && Number(value) !== Number(row.version || 1)) throw conflict("Shift swap was updated by another request");
}

export const staffShiftSwapService = {
  coworkers(access) {
    const staffId = selfStaffId(access);
    if (!staffId) throw forbidden("Staff profile is required");
    const current = db.prepare(`SELECT branch_id FROM staff_master WHERE id = @staffId AND tenant_id = @tenantId`)
      .get({ staffId, tenantId: access.tenantId });
    if (!current) throw notFound("Staff profile not found");
    return db.prepare(`SELECT id, full_name AS name, branch_id AS branchId, designation
      FROM staff_master WHERE tenant_id = @tenantId AND branch_id = @branchId AND id != @staffId AND status = 'active'
      ORDER BY full_name`).all({ tenantId: access.tenantId, branchId: current.branch_id, staffId });
  },

  listForSelf(query = {}, access) {
    const staffId = selfStaffId(access);
    if (!staffId) throw forbidden("Staff profile is required");
    const params = { tenantId: access.tenantId, staffId };
    const status = String(query.status || "").trim();
    return enrichedRows(`sw.tenant_id = @tenantId AND (sw.from_staff_id = @staffId OR sw.to_staff_id = @staffId)${status ? " AND sw.status = @status" : ""}`,
      status ? { ...params, status } : params, 100);
  },

  request(payload = {}, access) {
    const fromStaffId = selfStaffId(access);
    if (!fromStaffId) throw forbidden("Staff profile is required");
    const schedule = db.prepare(`SELECT * FROM staff_schedules
      WHERE id = @scheduleId AND tenant_id = @tenantId AND staff_id = @staffId`)
      .get({ scheduleId: payload.scheduleId || "", tenantId: access.tenantId, staffId: fromStaffId });
    if (!schedule) throw notFound("Your shift was not found");
    tenantService.assertBranchAccess(access, schedule.branch_id);
    if (schedule.status === "cancelled" || schedule.schedule_date < businessDate() || shiftEnded(schedule)) throw badRequest("Only active shifts that have not ended can be swapped");
    const toStaffId = String(payload.toStaffId || "").trim();
    if (!toStaffId || toStaffId === fromStaffId) throw badRequest("Choose another staff member");
    const target = db.prepare(`SELECT * FROM staff_master
      WHERE id = @staffId AND tenant_id = @tenantId AND branch_id = @branchId AND status = 'active'`)
      .get({ staffId: toStaffId, tenantId: access.tenantId, branchId: schedule.branch_id });
    if (!target) throw badRequest("Selected coworker is not active in this branch");
    if (targetConflict(schedule, toStaffId, access.tenantId)) throw conflict("Selected coworker already has an overlapping shift");
    const row = {
      id: makeId("swap"), tenant_id: access.tenantId, branch_id: schedule.branch_id, schedule_id: schedule.id,
      from_staff_id: fromStaffId, to_staff_id: toStaffId, reason: String(payload.reason || "").trim(), status: "pending_staff",
      requested_schedule_date: schedule.schedule_date, requested_start_time: schedule.start_time,
      requested_end_time: schedule.end_time, requested_shift_type: schedule.shift_type || ""
    };
    const inserted = db.prepare(`INSERT INTO staff_shift_swaps
      (id, tenant_id, branch_id, schedule_id, from_staff_id, to_staff_id, reason, status,
       requested_schedule_date, requested_start_time, requested_end_time, requested_shift_type)
      SELECT @id, @tenant_id, @branch_id, @schedule_id, @from_staff_id, @to_staff_id, @reason, @status,
       @requested_schedule_date, @requested_start_time, @requested_end_time, @requested_shift_type
      WHERE NOT EXISTS (SELECT 1 FROM staff_shift_swaps
        WHERE tenant_id = @tenant_id AND schedule_id = @schedule_id AND status IN ('pending', 'pending_staff', 'pending_manager'))`).run(row);
    if (inserted.changes !== 1) throw conflict("A swap request is already active for this shift");
    notification({ tenantId: row.tenant_id, branchId: row.branch_id, staffId: toStaffId, type: "shift_swap_requested",
      title: "Shift swap request", body: `A coworker requested your ${schedule.schedule_date} shift cover.`, swapId: row.id });
    broadcast("staff:shift_swap_requested", row);
    return enrichedRows("sw.tenant_id = @tenantId AND sw.id = @id", { tenantId: access.tenantId, id: row.id }, 1)[0];
  },

  respond(id, payload = {}, access) {
    const staffId = selfStaffId(access);
    const swap = loadSwap(id, access.tenantId);
    if (swap.to_staff_id !== staffId) throw forbidden("Only the requested coworker can respond");
    if (swap.status !== "pending_staff") throw badRequest("This request no longer needs a coworker response");
    assertVersion(swap, payload.version);
    const decision = payload.decision === "accept" ? "accept" : payload.decision === "decline" ? "decline" : "";
    if (!decision) throw badRequest("Decision must be accept or decline");
    const status = decision === "accept" ? "pending_manager" : "declined";
    const stamp = now();
    const changed = db.prepare(`UPDATE staff_shift_swaps SET status = @status, target_responded_at = @stamp,
      target_response_note = @note, version = version + 1, updated_at = @stamp
      WHERE id = @id AND tenant_id = @tenantId AND status = 'pending_staff' AND version = @version`)
      .run({ status, stamp, note: String(payload.note || "").trim(), id, tenantId: access.tenantId, version: swap.version });
    if (changed.changes !== 1) throw conflict("Shift swap was updated by another request");
    const updated = loadSwap(id, access.tenantId);
    notification({ tenantId: updated.tenant_id, branchId: updated.branch_id, staffId: updated.from_staff_id,
      type: `shift_swap_${status}`, title: decision === "accept" ? "Swap accepted by coworker" : "Swap declined",
      body: decision === "accept" ? "The accepted shift swap is waiting for owner approval." : "The coworker declined the shift swap.", swapId: id });
    if (status === "pending_manager") notifyOwnersForApproval(updated);
    broadcast(`staff:shift_swap_${status}`, updated);
    return enrichedRows("sw.tenant_id = @tenantId AND sw.id = @id", { tenantId: access.tenantId, id }, 1)[0];
  },

  cancel(id, payload = {}, access) {
    const staffId = selfStaffId(access);
    const swap = loadSwap(id, access.tenantId);
    if (swap.from_staff_id !== staffId) throw forbidden("Only the requester can cancel this swap");
    if (terminalStatuses.has(swap.status)) throw badRequest("This swap is already closed");
    assertVersion(swap, payload.version);
    const stamp = now();
    const changed = db.prepare(`UPDATE staff_shift_swaps SET status = 'cancelled', cancelled_at = @stamp,
      version = version + 1, updated_at = @stamp WHERE id = @id AND tenant_id = @tenantId
      AND status IN ('pending_staff', 'pending_manager') AND version = @version`)
      .run({ stamp, id, tenantId: access.tenantId, version: swap.version });
    if (changed.changes !== 1) throw conflict("Shift swap was updated by another request");
    const updated = loadSwap(id, access.tenantId);
    notification({ tenantId: updated.tenant_id, branchId: updated.branch_id, staffId: updated.to_staff_id,
      type: "shift_swap_cancelled", title: "Shift swap cancelled", body: "The shift swap request was cancelled.", swapId: id });
    broadcast("staff:shift_swap_cancelled", updated);
    return enrichedRows("sw.tenant_id = @tenantId AND sw.id = @id", { tenantId: access.tenantId, id }, 1)[0];
  },

  listForManager(query = {}, access) {
    requireManager(access);
    let branchId = String(query.branchId || query.branch_id || "").trim();
    if (!ownerControlRoles.has(String(access.role || "").toLowerCase())) branchId = String(access.branchId || access.requestedBranchId || "").trim();
    if (!branchId && !ownerControlRoles.has(String(access.role || "").toLowerCase())) throw forbidden("Branch access is required");
    if (branchId && branchId !== "all") tenantService.assertBranchAccess(access, branchId);
    const status = String(query.status || "").trim();
    const filters = ["sw.tenant_id = @tenantId"];
    const params = { tenantId: access.tenantId };
    if (branchId && branchId !== "all") { filters.push("sw.branch_id = @branchId"); params.branchId = branchId; }
    if (status) { filters.push("sw.status = @status"); params.status = status; }
    return enrichedRows(filters.join(" AND "), params, 200);
  },

  createForManager(payload = {}, access) {
    requireManager(access);
    const schedule = db.prepare(`SELECT * FROM staff_schedules WHERE id = @scheduleId AND tenant_id = @tenantId`)
      .get({ scheduleId: payload.scheduleId || payload.schedule_id || "", tenantId: access.tenantId });
    if (!schedule) throw notFound("Schedule not found");
    tenantService.assertBranchAccess(access, schedule.branch_id);
    if (schedule.status === "cancelled" || shiftEnded(schedule)) throw badRequest("Only active shifts that have not ended can be reassigned");
    const toStaffId = String(payload.toStaffId || payload.to_staff_id || "").trim();
    if (!toStaffId || toStaffId === schedule.staff_id) throw badRequest("Choose another staff member");
    const target = db.prepare(`SELECT id FROM staff_master WHERE id = @staffId AND tenant_id = @tenantId
      AND branch_id = @branchId AND status = 'active'`).get({ staffId: toStaffId, tenantId: access.tenantId, branchId: schedule.branch_id });
    if (!target) throw badRequest("Selected staff member is not active in this branch");
    if (targetConflict(schedule, toStaffId, access.tenantId)) throw conflict("Selected staff member already has an overlapping shift");
    const row = {
      id: makeId("swap"), tenant_id: access.tenantId, branch_id: schedule.branch_id, schedule_id: schedule.id,
      from_staff_id: schedule.staff_id, to_staff_id: toStaffId, reason: String(payload.reason || "").trim(), status: "pending_staff",
      requested_schedule_date: schedule.schedule_date, requested_start_time: schedule.start_time,
      requested_end_time: schedule.end_time, requested_shift_type: schedule.shift_type || ""
    };
    const inserted = db.prepare(`INSERT INTO staff_shift_swaps
      (id, tenant_id, branch_id, schedule_id, from_staff_id, to_staff_id, reason, status,
       requested_schedule_date, requested_start_time, requested_end_time, requested_shift_type)
      SELECT @id, @tenant_id, @branch_id, @schedule_id, @from_staff_id, @to_staff_id, @reason, @status,
       @requested_schedule_date, @requested_start_time, @requested_end_time, @requested_shift_type
      WHERE NOT EXISTS (SELECT 1 FROM staff_shift_swaps
        WHERE tenant_id = @tenant_id AND schedule_id = @schedule_id AND status IN ('pending', 'pending_staff', 'pending_manager'))`).run(row);
    if (inserted.changes !== 1) throw conflict("A swap request is already active for this shift");
    notification({ tenantId: row.tenant_id, branchId: row.branch_id, staffId: row.to_staff_id, type: "shift_reassignment_proposed",
      title: "Shift reassignment proposed", body: `A manager proposed your ${schedule.schedule_date} shift assignment. Accept or decline the request.`, swapId: row.id });
    broadcast("staff:shift_swap_requested", row);
    return enrichedRows("sw.tenant_id = @tenantId AND sw.id = @id", { tenantId: access.tenantId, id: row.id }, 1)[0];
  },

  approve(id, payload = {}, access) {
    requireOwnerControl(access);
    const swap = loadSwap(id, access.tenantId);
    tenantService.assertBranchAccess(access, swap.branch_id);
    if (swap.status !== "pending_manager") throw badRequest("Coworker acceptance is required before approval");
    assertVersion(swap, payload.version);
    const stamp = now();
    let scheduleDate = "";
    const transaction = db.transaction(() => {
      const current = loadSwap(id, access.tenantId);
      if (current.status !== "pending_manager" || Number(current.version) !== Number(swap.version)) throw conflict("Shift swap was updated by another request");
      const schedule = db.prepare(`SELECT * FROM staff_schedules WHERE id = @id AND tenant_id = @tenantId`)
        .get({ id: current.schedule_id, tenantId: access.tenantId });
      if (!schedule || schedule.staff_id !== current.from_staff_id) throw conflict("The original shift assignment has changed");
      if (schedule.status === "cancelled" || schedule.schedule_date < businessDate() || shiftEnded(schedule)) throw conflict("The accepted shift is no longer active");
      if (current.requested_schedule_date && (schedule.schedule_date !== current.requested_schedule_date
        || schedule.start_time !== current.requested_start_time || schedule.end_time !== current.requested_end_time
        || String(schedule.shift_type || "") !== String(current.requested_shift_type || ""))) throw conflict("The shift changed after coworker acceptance; create a new request");
      const target = db.prepare(`SELECT id FROM staff_master WHERE id = @staffId AND tenant_id = @tenantId
        AND branch_id = @branchId AND status = 'active'`).get({ staffId: current.to_staff_id, tenantId: access.tenantId, branchId: current.branch_id });
      if (!target) throw conflict("The target staff member is no longer active in this branch");
      if (targetConflict(schedule, current.to_staff_id, access.tenantId)) throw conflict("Target staff now has an overlapping shift");
      scheduleDate = schedule.schedule_date;
      const decision = db.prepare(`UPDATE staff_shift_swaps SET status = 'approved', approved_by = @approvedBy,
        approved_at = @stamp, version = version + 1, updated_at = @stamp
        WHERE id = @id AND tenant_id = @tenantId AND status = 'pending_manager' AND version = @version`)
        .run({ approvedBy: access.userId || "", stamp, id, tenantId: access.tenantId, version: swap.version });
      if (decision.changes !== 1) throw conflict("Shift swap was updated by another request");
      const reassigned = db.prepare(`UPDATE staff_schedules SET staff_id = @toStaffId, version = version + 1, updated_at = @stamp
        WHERE id = @scheduleId AND tenant_id = @tenantId AND staff_id = @fromStaffId`)
        .run({ toStaffId: current.to_staff_id, stamp, scheduleId: current.schedule_id, tenantId: access.tenantId, fromStaffId: current.from_staff_id });
      if (reassigned.changes !== 1) throw conflict("The original shift assignment has changed");
    });
    transaction();
    const updated = loadSwap(id, access.tenantId);
    for (const staffId of [updated.from_staff_id, updated.to_staff_id]) notification({ tenantId: updated.tenant_id,
      branchId: updated.branch_id, staffId, type: "shift_swap_approved", title: "Shift swap approved",
      body: `The ${scheduleDate} shift was reassigned.`, swapId: id });
    broadcast("staff:shift_swap_approved", updated);
    return enrichedRows("sw.tenant_id = @tenantId AND sw.id = @id", { tenantId: access.tenantId, id }, 1)[0];
  },

  reject(id, payload = {}, access) {
    requireOwnerControl(access);
    const reason = String(payload.reason || "").trim();
    if (!reason) throw badRequest("Rejection reason is required");
    const swap = loadSwap(id, access.tenantId);
    tenantService.assertBranchAccess(access, swap.branch_id);
    if (swap.status !== "pending_manager") throw badRequest("Only owner-pending swaps can be rejected");
    assertVersion(swap, payload.version);
    const stamp = now();
    const changed = db.prepare(`UPDATE staff_shift_swaps SET status = 'rejected', rejected_by = @rejectedBy,
      rejected_at = @stamp, rejection_reason = @reason, version = version + 1, updated_at = @stamp
      WHERE id = @id AND tenant_id = @tenantId AND status = 'pending_manager' AND version = @version`)
      .run({ rejectedBy: access.userId || "", stamp, reason, id, tenantId: access.tenantId, version: swap.version });
    if (changed.changes !== 1) throw conflict("Shift swap was updated by another request");
    const updated = loadSwap(id, access.tenantId);
    for (const staffId of [updated.from_staff_id, updated.to_staff_id]) notification({ tenantId: updated.tenant_id,
      branchId: updated.branch_id, staffId, type: "shift_swap_rejected", title: "Shift swap rejected",
      body: updated.rejection_reason || "The owner rejected the shift swap.", swapId: id });
    broadcast("staff:shift_swap_rejected", updated);
    return enrichedRows("sw.tenant_id = @tenantId AND sw.id = @id", { tenantId: access.tenantId, id }, 1)[0];
  }
};
