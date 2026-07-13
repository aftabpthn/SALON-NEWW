import { createHash, randomUUID } from "node:crypto";
import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { staffOvertimeService } from "./staff-overtime.service.js";
import { tenantService } from "./tenant.service.js";

const managerRoles = new Set(["owner", "admin", "superAdmin", "manager"]);
const sensitiveActions = new Set([
  "salary_change",
  "payroll_intelligence_update",
  "commission_rule_update",
  "attendance_update",
  "skill_license_update"
]);

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

function normalizeRole(role = "") {
  const value = String(role || "").trim();
  const compact = value.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "superadmin") return "superAdmin";
  if (compact === "frontdesk") return "frontDesk";
  if (compact === "inventorymanager") return "inventoryManager";
  if (compact === "custommarketinglead") return "customMarketingLead";
  return value;
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function requireTenant(access = {}) {
  if (!access.tenantId) throw forbidden("Tenant context is required");
  return { ...access, role: normalizeRole(access.role) };
}

function requireManager(access = {}) {
  const scopedAccess = requireTenant(access);
  if (!managerRoles.has(scopedAccess.role)) throw forbidden("Manager approval is required");
}

function branchAccess(access, branchId = "") {
  if (branchId) tenantService.assertBranchAccess(access, branchId);
}

function staffById(staffId, access) {
  if (!staffId) throw badRequest("staffId is required");
  const staff = repositories.staff.getById(staffId, { tenantId: access.tenantId });
  if (!staff) throw notFound("Staff member not found");
  branchAccess(access, staff.branchId || "");
  return staff;
}

function latestAuditHash(tenantId) {
  return db.prepare("SELECT eventHash FROM staff_zero_trust_audit WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1").get(tenantId)?.eventHash || "";
}

function normalizeAction(payload = {}) {
  return String(payload.actionRequested || payload.actionType || payload.requestType || "").trim();
}

function approvalById(id, access) {
  const row = db.prepare("SELECT * FROM staff_approval_requests WHERE id = ? AND tenantId = ?").get(id, access.tenantId);
  if (!row) throw notFound("Staff enterprise approval request not found");
  branchAccess(access, row.branchId || "");
  return row;
}

function auditHash(row) {
  const source = [
    row.tenantId,
    row.branchId || "",
    row.staffId || "",
    row.actorId || "",
    row.actionType,
    row.entityType,
    row.entityId || "",
    row.beforeJson || "{}",
    row.afterJson || "{}",
    row.metadataJson || "{}",
    row.previousEventHash || "",
    row.createdAt
  ].join("|");
  return createHash("sha256").update(source).digest("hex");
}

function camelApproval(row) {
  if (!row) return row;
  return {
    ...row,
    beforeJson: parseJson(row.beforeJson, {}),
    afterJson: parseJson(row.afterJson, {})
  };
}

function allowedUpdate(payload = {}, keys) {
  return Object.fromEntries(keys.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
}

function setClause(values) {
  const keys = Object.keys(values);
  return keys.map((key) => `${key} = @${key}`).join(", ");
}

export class StaffEnterpriseActionService {
  assignTraining(payload = {}, access, requestMeta = {}) {
    access = requireTenant(access);
    const staff = staffById(payload.staffId, access);
    const branchId = String(payload.branchId || staff.branchId || access.requestedBranchId || "");
    branchAccess(access, branchId);
    const trainingTitle = String(payload.trainingTitle || payload.title || "").trim();
    if (!trainingTitle) throw badRequest("trainingTitle is required");
    const stamp = now();
    const row = {
      id: makeId("train"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      trainingType: payload.trainingType || "performance_coaching",
      trainingTitle,
      triggerSignalId: payload.triggerSignalId || "",
      assignedBy: access.userId || access.role || "",
      assignedAt: stamp,
      dueAt: payload.dueAt || payload.dueDate || "",
      completedAt: "",
      score: 0,
      resultJson: toJson(payload.resultJson || { source: "staff-enterprise" }),
      status: payload.status || "assigned",
      archivedAt: "",
      version: 1,
      createdBy: access.userId || access.role || "",
      createdAt: stamp,
      updatedAt: stamp
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_training_assignments
        (id, tenantId, branchId, staffId, trainingType, trainingTitle, triggerSignalId, assignedBy, assignedAt, dueAt, completedAt, score, resultJson, status, archivedAt, version, createdBy, createdAt, updatedAt)
        VALUES (@id, @tenantId, @branchId, @staffId, @trainingType, @trainingTitle, @triggerSignalId, @assignedBy, @assignedAt, @dueAt, @completedAt, @score, @resultJson, @status, @archivedAt, @version, @createdBy, @createdAt, @updatedAt)`).run(row);
      this.recordAudit({
        actionType: "training_assigned",
        entityType: "staff_training_assignments",
        entityId: row.id,
        staffId: staff.id,
        branchId,
        afterJson: row,
        metadataJson: { route: "/staff-enterprise/training/assign", requestMeta }
      }, access, requestMeta);
    })();
    return { ...row, resultJson: parseJson(row.resultJson, {}) };
  }

  createApprovalRequest(payload = {}, access, requestMeta = {}) {
    access = requireTenant(access);
    const actionRequested = normalizeAction(payload);
    if (!actionRequested) throw badRequest("actionRequested is required");
    if (!sensitiveActions.has(actionRequested)) {
      throw badRequest(`Unsupported staff enterprise action: ${actionRequested}`);
    }
    const staff = payload.staffId ? staffById(payload.staffId, access) : null;
    const branchId = String(payload.branchId || staff?.branchId || access.requestedBranchId || "");
    branchAccess(access, branchId);
    const entityType = String(payload.entityType || this.defaultEntityType(actionRequested)).trim();
    if (!entityType) throw badRequest("entityType is required");
    const stamp = now();
    const beforeJson = payload.beforeJson ?? payload.before ?? this.snapshot(entityType, payload.entityId || "", access);
    const afterJson = payload.afterJson ?? payload.after ?? {};
    const row = {
      id: makeId("seappr"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff?.id || payload.staffId || "",
      requestType: payload.requestType || actionRequested,
      entityType,
      entityId: payload.entityId || "",
      actionRequested,
      beforeJson: toJson(beforeJson),
      afterJson: toJson(afterJson),
      reason: payload.reason || "",
      sensitivityLevel: payload.sensitivityLevel || "sensitive",
      requestedBy: access.userId || access.role || "",
      requestedByRole: access.role || "",
      requestedAt: stamp,
      approvedBy: "",
      approvedAt: "",
      rejectedBy: "",
      rejectedAt: "",
      rejectionReason: "",
      expiresAt: payload.expiresAt || "",
      status: "pending",
      archivedAt: "",
      version: 1,
      createdBy: access.userId || access.role || "",
      createdAt: stamp,
      updatedAt: stamp
    };
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_approval_requests
        (id, tenantId, branchId, staffId, requestType, entityType, entityId, actionRequested, beforeJson, afterJson, reason, sensitivityLevel, requestedBy, requestedByRole, requestedAt, approvedBy, approvedAt, rejectedBy, rejectedAt, rejectionReason, expiresAt, status, archivedAt, version, createdBy, createdAt, updatedAt)
        VALUES (@id, @tenantId, @branchId, @staffId, @requestType, @entityType, @entityId, @actionRequested, @beforeJson, @afterJson, @reason, @sensitivityLevel, @requestedBy, @requestedByRole, @requestedAt, @approvedBy, @approvedAt, @rejectedBy, @rejectedAt, @rejectionReason, @expiresAt, @status, @archivedAt, @version, @createdBy, @createdAt, @updatedAt)`).run(row);
      this.recordAudit({
        actionType: "approval_requested",
        entityType: "staff_approval_requests",
        entityId: row.id,
        staffId: row.staffId,
        branchId,
        afterJson: row,
        metadataJson: { route: "/staff-enterprise/approval-request", requestMeta }
      }, access, requestMeta);
    })();
    return camelApproval(row);
  }

  approve(payload = {}, access, requestMeta = {}) {
    access = requireTenant(access);
    requireManager(access);
    const id = payload.id || payload.approvalRequestId || payload.approvalId;
    if (!id) throw badRequest("approvalRequestId is required");
    const request = approvalById(id, access);
    if (request.status !== "pending") throw conflict(`Approval request is already ${request.status}`);
    const after = parseJson(request.afterJson, {});
    const before = this.snapshot(request.entityType, request.entityId, access);
    let applied;
    db.transaction(() => {
      applied = this.applyApprovedAction(request, after, access);
      const stamp = now();
      db.prepare(`UPDATE staff_approval_requests
        SET status = 'approved', approvedBy = ?, approvedAt = ?, updatedAt = ?, version = version + 1
        WHERE id = ? AND tenantId = ?`).run(access.userId || access.role || "", stamp, stamp, request.id, access.tenantId);
      this.recordAudit({
        actionType: "approval_approved",
        entityType: "staff_approval_requests",
        entityId: request.id,
        staffId: request.staffId || applied?.staffId || "",
        branchId: request.branchId || applied?.branchId || "",
        beforeJson: before,
        afterJson: applied,
        metadataJson: { route: "/staff-enterprise/approve", actionRequested: request.actionRequested, requestMeta }
      }, access, requestMeta);
    })();
    return { ...camelApproval(approvalById(request.id, access)), applied };
  }

  reject(payload = {}, access, requestMeta = {}) {
    access = requireTenant(access);
    requireManager(access);
    const id = payload.id || payload.approvalRequestId || payload.approvalId;
    if (!id) throw badRequest("approvalRequestId is required");
    const request = approvalById(id, access);
    if (request.status !== "pending") throw conflict(`Approval request is already ${request.status}`);
    const stamp = now();
    db.transaction(() => {
      db.prepare(`UPDATE staff_approval_requests
        SET status = 'rejected', rejectedBy = ?, rejectedAt = ?, rejectionReason = ?, updatedAt = ?, version = version + 1
        WHERE id = ? AND tenantId = ?`).run(access.userId || access.role || "", stamp, payload.rejectionReason || payload.reason || "", stamp, request.id, access.tenantId);
      this.recordAudit({
        actionType: "approval_rejected",
        entityType: "staff_approval_requests",
        entityId: request.id,
        staffId: request.staffId || "",
        branchId: request.branchId || "",
        beforeJson: request,
        afterJson: { status: "rejected", rejectionReason: payload.rejectionReason || payload.reason || "" },
        metadataJson: { route: "/staff-enterprise/reject", actionRequested: request.actionRequested, dataChanged: false, requestMeta }
      }, access, requestMeta);
    })();
    return camelApproval(approvalById(request.id, access));
  }

  manualAuditEvent(payload = {}, access, requestMeta = {}) {
    access = requireTenant(access);
    const actionType = String(payload.actionType || "").trim();
    const entityType = String(payload.entityType || "").trim();
    if (!actionType || !entityType) throw badRequest("actionType and entityType are required");
    const staffId = payload.staffId || "";
    if (staffId) staffById(staffId, access);
    const branchId = String(payload.branchId || access.requestedBranchId || "");
    branchAccess(access, branchId);
    return this.recordAudit({
      actionType,
      entityType,
      entityId: payload.entityId || "",
      staffId,
      branchId,
      beforeJson: payload.beforeJson || payload.before || {},
      afterJson: payload.afterJson || payload.after || {},
      metadataJson: { ...(payload.metadataJson || payload.metadata || {}), route: "/staff-enterprise/audit-event", requestMeta },
      status: payload.status || "recorded"
    }, access, requestMeta);
  }

  recordAudit(payload = {}, access, requestMeta = {}) {
    access = requireTenant(access);
    const stamp = now();
    const previousEventHash = latestAuditHash(access.tenantId);
    const row = {
      id: makeId("ztaudit"),
      tenantId: access.tenantId,
      branchId: payload.branchId || "",
      staffId: payload.staffId || "",
      actorId: access.userId || "system-user",
      actorRole: access.role || "",
      actionType: payload.actionType,
      entityType: payload.entityType,
      entityId: payload.entityId || "",
      beforeJson: toJson(payload.beforeJson || {}),
      afterJson: toJson(payload.afterJson || {}),
      metadataJson: toJson(payload.metadataJson || {}),
      ipAddress: requestMeta.ipAddress || "",
      userAgent: requestMeta.userAgent || "",
      status: payload.status || "recorded",
      eventHash: "",
      previousEventHash,
      createdAt: stamp
    };
    row.eventHash = auditHash(row);
    db.prepare(`INSERT INTO staff_zero_trust_audit
      (id, tenantId, branchId, staffId, actorId, actorRole, actionType, entityType, entityId, beforeJson, afterJson, metadataJson, ipAddress, userAgent, status, eventHash, previousEventHash, createdAt)
      VALUES (@id, @tenantId, @branchId, @staffId, @actorId, @actorRole, @actionType, @entityType, @entityId, @beforeJson, @afterJson, @metadataJson, @ipAddress, @userAgent, @status, @eventHash, @previousEventHash, @createdAt)`).run(row);
    return {
      ...row,
      beforeJson: parseJson(row.beforeJson, {}),
      afterJson: parseJson(row.afterJson, {}),
      metadataJson: parseJson(row.metadataJson, {})
    };
  }

  defaultEntityType(actionRequested) {
    return {
      attendance_update: "staff_attendance",
      commission_rule_update: "commissions",
      payroll_intelligence_update: "staff_payroll_intelligence",
      salary_change: "staff_payroll_intelligence",
      skill_license_update: "staff_skill_licenses"
    }[actionRequested] || "";
  }

  snapshot(entityType, entityId, access) {
    if (!entityType || !entityId) return {};
    const allowedTables = new Set(["staff_attendance", "commissions", "staff_payroll_intelligence", "staff_skill_licenses"]);
    if (!allowedTables.has(entityType)) return {};
    const row = db.prepare(`SELECT * FROM ${entityType} WHERE id = ?`).get(entityId);
    if (!row) return {};
    if (row.tenantId && row.tenantId !== access.tenantId) return {};
    if (row.branchId) branchAccess(access, row.branchId);
    return row;
  }

  applyApprovedAction(request, after, access) {
    switch (request.actionRequested) {
      case "attendance_update":
        return this.applyAttendanceUpdate(request, after, access);
      case "commission_rule_update":
        return this.applyCommissionRuleUpdate(request, after, access);
      case "salary_change":
      case "payroll_intelligence_update":
        return this.applyPayrollIntelligence(request, after, access);
      case "skill_license_update":
        return this.applySkillLicense(request, after, access);
      default:
        throw badRequest(`Unsupported approval action: ${request.actionRequested}`);
    }
  }

  applyAttendanceUpdate(request, after, access) {
    if (!request.entityId) throw badRequest("attendance_update requires entityId");
    const current = db.prepare("SELECT * FROM staff_attendance WHERE id = ?").get(request.entityId);
    if (!current || current.tenantId !== access.tenantId) throw notFound("Attendance record not found");
    branchAccess(access, current.branchId || "");
    const update = allowedUpdate(after, ["date", "status", "clockIn", "clockOut", "minutesWorked", "overtimeMinutes", "notes"]);
    if (!Object.keys(update).length) throw badRequest("attendance_update afterJson has no allowed fields");
    const snapshot = staffOvertimeService.snapshot(access.tenantId, "staff_attendance", current.id);
    const clockInAt = update.clockIn ?? current.clockIn;
    const clockOutAt = update.clockOut ?? current.clockOut;
    if (snapshot && clockOutAt) {
      const calculation = staffOvertimeService.completeSnapshot({
        tenantId: access.tenantId,
        attendanceSource: "staff_attendance",
        attendanceId: current.id,
        clockInAt,
        clockOutAt,
        completedBreakMinutes: snapshot.completedBreakMinutes
      });
      update.minutesWorked = calculation.workedMinutes;
      update.overtimeMinutes = calculation.overtimeMinutes;
    }
    update.updatedAt = now();
    db.prepare(`UPDATE staff_attendance SET ${setClause(update)} WHERE id = @id AND tenantId = @tenantId`)
      .run({ ...update, id: current.id, tenantId: access.tenantId });
    return db.prepare("SELECT * FROM staff_attendance WHERE id = ? AND tenantId = ?").get(current.id, access.tenantId);
  }

  applyCommissionRuleUpdate(request, after, access) {
    const branchId = String(after.branchId || request.branchId || "");
    branchAccess(access, branchId);
    const update = allowedUpdate(after, ["name", "type", "value", "rule", "tiers", "metadata", "status"]);
    if (update.rule && typeof update.rule !== "string") update.rule = toJson(update.rule);
    if (update.tiers && typeof update.tiers !== "string") update.tiers = toJson(update.tiers);
    if (update.metadata && typeof update.metadata !== "string") update.metadata = toJson(update.metadata);
    update.updatedAt = now();
    if (request.entityId) {
      const current = db.prepare("SELECT * FROM commissions WHERE id = ? AND tenantId = ?").get(request.entityId, access.tenantId);
      if (!current) throw notFound("Commission rule not found");
      branchAccess(access, current.branchId || "");
      if (!Object.keys(update).filter((key) => key !== "updatedAt").length) throw badRequest("commission_rule_update afterJson has no allowed fields");
      db.prepare(`UPDATE commissions SET ${setClause(update)} WHERE id = @id AND tenantId = @tenantId`)
        .run({ ...update, id: current.id, tenantId: access.tenantId });
      return db.prepare("SELECT * FROM commissions WHERE id = ? AND tenantId = ?").get(current.id, access.tenantId);
    }
    const staff = staffById(after.staffId || request.staffId, access);
    const row = {
      id: makeId("commrule"),
      tenantId: access.tenantId,
      branchId: branchId || staff.branchId || "",
      staffId: staff.id,
      name: after.name || "Approved commission rule",
      type: after.type || "percentage",
      value: money(after.value),
      rule: typeof after.rule === "string" ? after.rule : toJson(after.rule || {}),
      tiers: typeof after.tiers === "string" ? after.tiers : toJson(after.tiers || []),
      metadata: typeof after.metadata === "string" ? after.metadata : toJson(after.metadata || { approvalRequestId: request.id }),
      status: after.status || "active",
      createdAt: now(),
      updatedAt: now()
    };
    db.prepare(`INSERT INTO commissions
      (id, tenantId, branchId, staffId, name, type, value, rule, tiers, metadata, status, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @staffId, @name, @type, @value, @rule, @tiers, @metadata, @status, @createdAt, @updatedAt)`).run(row);
    return row;
  }

  applyPayrollIntelligence(request, after, access) {
    const staff = staffById(after.staffId || request.staffId, access);
    const branchId = String(after.branchId || request.branchId || staff.branchId || "");
    branchAccess(access, branchId);
    const periodStart = String(after.periodStart || "").slice(0, 10);
    const periodEnd = String(after.periodEnd || periodStart).slice(0, 10);
    if (!periodStart || !periodEnd) throw badRequest("periodStart and periodEnd are required");
    const existing = request.entityId
      ? db.prepare("SELECT * FROM staff_payroll_intelligence WHERE id = ? AND tenantId = ?").get(request.entityId, access.tenantId)
      : db.prepare("SELECT * FROM staff_payroll_intelligence WHERE tenantId = ? AND staffId = ? AND periodStart = ? AND periodEnd = ?")
        .get(access.tenantId, staff.id, periodStart, periodEnd);
    const row = {
      id: existing?.id || makeId("payintel"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      periodStart,
      periodEnd,
      grossPay: money(after.grossPay),
      commissionAmount: money(after.commissionAmount),
      incentiveAmount: money(after.incentiveAmount),
      deductionAmount: money(after.deductionAmount),
      statutoryJson: toJson(after.statutoryJson || {}),
      anomalyJson: toJson(after.anomalyJson || { approvalRequestId: request.id }),
      complianceRiskLevel: after.complianceRiskLevel || "low",
      payoutRecommendationJson: toJson(after.payoutRecommendationJson || {}),
      status: after.status || "approved",
      archivedAt: existing?.archivedAt || "",
      version: Number(existing?.version || 0) + 1,
      createdBy: existing?.createdBy || request.requestedBy || access.userId || access.role || "",
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    if (existing) {
      db.prepare(`UPDATE staff_payroll_intelligence SET
        branchId = @branchId, staffId = @staffId, periodStart = @periodStart, periodEnd = @periodEnd,
        grossPay = @grossPay, commissionAmount = @commissionAmount, incentiveAmount = @incentiveAmount,
        deductionAmount = @deductionAmount, statutoryJson = @statutoryJson, anomalyJson = @anomalyJson,
        complianceRiskLevel = @complianceRiskLevel, payoutRecommendationJson = @payoutRecommendationJson,
        status = @status, archivedAt = @archivedAt, version = @version, updatedAt = @updatedAt
        WHERE id = @id AND tenantId = @tenantId`).run(row);
    } else {
      db.prepare(`INSERT INTO staff_payroll_intelligence
        (id, tenantId, branchId, staffId, periodStart, periodEnd, grossPay, commissionAmount, incentiveAmount, deductionAmount, statutoryJson, anomalyJson, complianceRiskLevel, payoutRecommendationJson, status, archivedAt, version, createdBy, createdAt, updatedAt)
        VALUES (@id, @tenantId, @branchId, @staffId, @periodStart, @periodEnd, @grossPay, @commissionAmount, @incentiveAmount, @deductionAmount, @statutoryJson, @anomalyJson, @complianceRiskLevel, @payoutRecommendationJson, @status, @archivedAt, @version, @createdBy, @createdAt, @updatedAt)`).run(row);
    }
    return row;
  }

  applySkillLicense(request, after, access) {
    const staff = staffById(after.staffId || request.staffId, access);
    const branchId = String(after.branchId || request.branchId || staff.branchId || "");
    branchAccess(access, branchId);
    const skillName = String(after.skillName || "").trim();
    if (!skillName) throw badRequest("skillName is required");
    const existing = request.entityId
      ? db.prepare("SELECT * FROM staff_skill_licenses WHERE id = ? AND tenantId = ?").get(request.entityId, access.tenantId)
      : db.prepare("SELECT * FROM staff_skill_licenses WHERE tenantId = ? AND staffId = ? AND serviceId = ? AND skillName = ?")
        .get(access.tenantId, staff.id, after.serviceId || "", skillName);
    const row = {
      id: existing?.id || makeId("skilllic"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      serviceId: after.serviceId || "",
      skillName,
      licenseType: after.licenseType || "internal",
      certificationStatus: after.certificationStatus || "certified",
      certifiedBy: after.certifiedBy || access.userId || access.role || "",
      certifiedAt: after.certifiedAt || now(),
      expiresAt: after.expiresAt || "",
      evidenceJson: toJson(after.evidenceJson || {}),
      restrictionLevel: after.restrictionLevel || "advisory",
      status: after.status || "active",
      archivedAt: existing?.archivedAt || "",
      version: Number(existing?.version || 0) + 1,
      createdBy: existing?.createdBy || request.requestedBy || access.userId || access.role || "",
      createdAt: existing?.createdAt || now(),
      updatedAt: now()
    };
    if (existing) {
      db.prepare(`UPDATE staff_skill_licenses SET
        branchId = @branchId, staffId = @staffId, serviceId = @serviceId, skillName = @skillName,
        licenseType = @licenseType, certificationStatus = @certificationStatus, certifiedBy = @certifiedBy,
        certifiedAt = @certifiedAt, expiresAt = @expiresAt, evidenceJson = @evidenceJson,
        restrictionLevel = @restrictionLevel, status = @status, archivedAt = @archivedAt, version = @version,
        updatedAt = @updatedAt
        WHERE id = @id AND tenantId = @tenantId`).run(row);
    } else {
      db.prepare(`INSERT INTO staff_skill_licenses
        (id, tenantId, branchId, staffId, serviceId, skillName, licenseType, certificationStatus, certifiedBy, certifiedAt, expiresAt, evidenceJson, restrictionLevel, status, archivedAt, version, createdBy, createdAt, updatedAt)
        VALUES (@id, @tenantId, @branchId, @staffId, @serviceId, @skillName, @licenseType, @certificationStatus, @certifiedBy, @certifiedAt, @expiresAt, @evidenceJson, @restrictionLevel, @status, @archivedAt, @version, @createdBy, @createdAt, @updatedAt)`).run(row);
    }
    return row;
  }
}

export const staffEnterpriseActionService = new StaffEnterpriseActionService();
