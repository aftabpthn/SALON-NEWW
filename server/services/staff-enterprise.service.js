import { db } from "../db.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";
import { smartStaffService } from "./smart-staff.service.js";
import { realtimeService } from "./realtime.service.js";
import { staffWebPushService } from "./staff-web-push.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const managerRoles = new Set(["owner", "admin", "superAdmin", "manager"]);

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

function requireManager(access) {
  if (!managerRoles.has(normalizeRole(access?.role))) throw forbidden("Manager approval is required");
}

function branchAccess(access, branchId = "") {
  if (branchId) tenantService.assertBranchAccess(access, branchId);
}

function recordById(table, id, access) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenantId = ?`).get(id, access.tenantId);
  if (!row) throw notFound("Staff enterprise record not found");
  branchAccess(access, row.branchId || "");
  return row;
}

function allByStaff(table, staffId, access) {
  return db.prepare(`SELECT * FROM ${table} WHERE tenantId = ? AND staffId = ? ORDER BY createdAt DESC`).all(access.tenantId, staffId);
}

function mapJson(row, fields) {
  const copy = { ...row };
  for (const field of fields) copy[field] = parseJson(copy[field], field.endsWith("s") ? [] : {});
  return copy;
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate || startDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function staffRow(staffId, access) {
  if (!staffId) throw badRequest("staffId is required");
  const row = db.prepare("SELECT * FROM staff WHERE id = ? AND tenantId = ?").get(staffId, access.tenantId);
  if (!row) throw notFound("Staff member not found");
  branchAccess(access, row.branchId || "");
  return row;
}

function latestStaffForBiometric(access, branchId = "") {
  const params = branchId ? [access.tenantId, branchId] : [access.tenantId];
  const sql = branchId
    ? "SELECT * FROM staff WHERE tenantId = ? AND branchId = ? ORDER BY createdAt DESC LIMIT 1"
    : "SELECT * FROM staff WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1";
  return db.prepare(sql).get(...params);
}

function insertApproval({ requestType, referenceId, staffId, branchId, status, reason, access, details = {} }) {
  const stamp = now();
  const row = {
    id: makeId("approval"),
    tenantId: access.tenantId,
    branchId: branchId || "",
    staffId: staffId || "",
    requestType,
    referenceId,
    status,
    requestedBy: access.userId || access.role || "",
    approvedBy: status === "approved" ? access.userId || access.role || "" : "",
    reason: reason || "",
    details: JSON.stringify(details),
    history: JSON.stringify([{ at: stamp, status, role: access.role, reason: reason || "" }]),
    createdAt: stamp,
    updatedAt: stamp
  };
  db.prepare(`
    INSERT INTO staff_approvals
      (id, tenantId, branchId, staffId, requestType, referenceId, status, requestedBy, approvedBy, reason, details, history, createdAt, updatedAt)
    VALUES
      (@id, @tenantId, @branchId, @staffId, @requestType, @referenceId, @status, @requestedBy, @approvedBy, @reason, @details, @history, @createdAt, @updatedAt)
  `).run(row);
  return row;
}

export class StaffEnterpriseService {
  profile(staffId, access) {
    const staff = staffRow(staffId, access);
    const shifts = allByStaff("staff_shifts", staffId, access).map((row) => mapJson(row, ["serviceIds"]));
    const biometricEvents = allByStaff("staff_biometric_events", staffId, access).map((row) => mapJson(row, ["payload"]));
    const leaveRequests = allByStaff("staff_leave_requests", staffId, access).map((row) => mapJson(row, ["history"]));
    const payrollComponents = allByStaff("staff_payroll_components", staffId, access).map((row) => mapJson(row, ["components", "deductionsBreakup"]));
    const commissionRules = allByStaff("staff_commission_rules", staffId, access).map((row) => mapJson(row, ["slabs", "rules"]));
    const documents = allByStaff("staff_documents", staffId, access).map((row) => mapJson(row, ["metadata"]));
    const skills = allByStaff("staff_skills", staffId, access).map((row) => mapJson(row, ["serviceIds", "certifications"]));
    const reviews = allByStaff("staff_reviews", staffId, access).map((row) => mapJson(row, ["metadata"]));
    const notifications = allByStaff("staff_notifications", staffId, access).map((row) => mapJson(row, ["payload"]));
    const transfers = allByStaff("staff_branch_transfers", staffId, access).map((row) => mapJson(row, ["history"]));
    const approvals = allByStaff("staff_approvals", staffId, access).map((row) => mapJson(row, ["details", "history"]));
    const ranking = smartStaffService.performance({ branchId: staff.branchId || "" }, access).find((row) => row.staffId === staffId);
    return {
      staff,
      shifts,
      biometricEvents,
      leaveRequests,
      payrollComponents,
      commissionRules,
      documents,
      skills,
      reviews,
      notifications,
      transfers,
      approvals,
      optimizer: {
        score: ranking?.performanceScore || 0,
        suggestions: [
          ranking?.attendanceScore < 80 ? "Improve punctuality before assigning peak-hour bookings." : "Attendance is safe for premium slots.",
          ranking?.serviceEfficiency < 70 ? "Pair with a senior stylist for advanced services." : "Eligible for high-value service assignments.",
          skills.length ? "Use skill matrix for smart booking suggestions." : "Add skill certifications to improve AI staff matching."
        ]
      }
    };
  }

  moveShift(id, payload = {}, access) {
    const shift = recordById("staff_shifts", id, access);
    const staff = staffRow(shift.staffId, access);
    const branchId = payload.branchId || shift.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    const updated = {
      date: payload.date || shift.date,
      startTime: payload.startTime || shift.startTime,
      endTime: payload.endTime || shift.endTime,
      branchId,
      status: payload.status || shift.status || "planned",
      updatedAt: now()
    };
    db.prepare(`
      UPDATE staff_shifts
      SET date = @date, startTime = @startTime, endTime = @endTime, branchId = @branchId, status = @status, updatedAt = @updatedAt
      WHERE id = @id AND tenantId = @tenantId
    `).run({ ...updated, id, tenantId: access.tenantId });
    return mapJson(recordById("staff_shifts", id, access), ["serviceIds"]);
  }

  recordBiometricEvent(payload = {}, access) {
    const employeeCode = String(payload.employeeCode || "").trim();
    if (!employeeCode) throw badRequest("employeeCode is required");
    const branchId = String(payload.branchId || access.branchId || "");
    branchAccess(access, branchId);
    const staff = latestStaffForBiometric(access, branchId);
    if (!staff) throw notFound("Staff member not found for biometric event");
    const attendance = smartStaffService.recordAttendance({
      staffId: staff.id,
      branchId: branchId || staff.branchId,
      date: String(payload.eventAt || now()).slice(0, 10),
      status: payload.eventType === "clock_out" ? "present" : "present",
      clockIn: payload.eventType === "clock_in" ? String(payload.eventAt || now()).slice(11, 16) : "",
      clockOut: payload.eventType === "clock_out" ? String(payload.eventAt || now()).slice(11, 16) : "",
      notes: `Biometric ${payload.eventType || "event"} from ${payload.deviceId || "device"}`
    }, access);
    const stamp = now();
    const row = {
      id: makeId("bio"),
      tenantId: access.tenantId,
      branchId: branchId || staff.branchId || "",
      staffId: staff.id,
      deviceId: payload.deviceId || "",
      employeeCode,
      eventType: payload.eventType || "clock_in",
      eventAt: payload.eventAt || stamp,
      attendanceId: attendance.id,
      status: "accepted",
      source: "biometric-placeholder",
      payload: JSON.stringify(payload),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_biometric_events
        (id, tenantId, branchId, staffId, deviceId, employeeCode, eventType, eventAt, attendanceId, status, source, payload, createdAt, updatedAt)
      VALUES
        (@id, @tenantId, @branchId, @staffId, @deviceId, @employeeCode, @eventType, @eventAt, @attendanceId, @status, @source, @payload, @createdAt, @updatedAt)
    `).run(row);
    return { event: mapJson(row, ["payload"]), attendance };
  }

  createLeave(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    if (!payload.startDate) throw badRequest("startDate is required");
    const stamp = now();
    const row = {
      id: makeId("leave"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      leaveType: payload.leaveType || "paid",
      startDate: payload.startDate,
      endDate: payload.endDate || payload.startDate,
      days: Number(payload.days || daysBetween(payload.startDate, payload.endDate || payload.startDate)),
      status: "pending",
      reason: payload.reason || "",
      decisionReason: "",
      approvedBy: "",
      history: JSON.stringify([{ at: stamp, status: "pending", role: access.role }]),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_leave_requests
        (id, tenantId, branchId, staffId, leaveType, startDate, endDate, days, status, reason, decisionReason, approvedBy, history, createdAt, updatedAt)
      VALUES
        (@id, @tenantId, @branchId, @staffId, @leaveType, @startDate, @endDate, @days, @status, @reason, @decisionReason, @approvedBy, @history, @createdAt, @updatedAt)
    `).run(row);
    insertApproval({ requestType: "leave", referenceId: row.id, staffId: staff.id, branchId, status: "pending", reason: payload.reason, access });
    return mapJson(row, ["history"]);
  }

  decideLeave(id, status, payload = {}, access) {
    requireManager(access);
    const row = recordById("staff_leave_requests", id, access);
    const stamp = now();
    const history = parseJson(row.history, []);
    history.push({ at: stamp, status, role: access.role, reason: payload.reason || "" });
    db.prepare(`
      UPDATE staff_leave_requests
      SET status = ?, decisionReason = ?, approvedBy = ?, history = ?, updatedAt = ?
      WHERE id = ? AND tenantId = ?
    `).run(status, payload.reason || "", access.userId || access.role || "", JSON.stringify(history), stamp, id, access.tenantId);
    insertApproval({ requestType: "leave", referenceId: id, staffId: row.staffId, branchId: row.branchId, status, reason: payload.reason, access });
    return mapJson(recordById("staff_leave_requests", id, access), ["history"]);
  }

  createPayrollComponent(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    const basic = Number(payload.basic || 0);
    const hra = Number(payload.hra || 0);
    const allowances = Number(payload.allowances || 0);
    const deductions = Number(payload.deductions || 0);
    const pf = Number(payload.pf || 0);
    const esi = Number(payload.esi || 0);
    const tds = Number(payload.tds || 0);
    const pt = Number(payload.pt || 0);
    const grossPay = basic + hra + allowances;
    const netPay = grossPay - deductions - pf - esi - tds - pt;
    const stamp = now();
    const row = {
      id: makeId("pay_comp"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      periodStart: payload.periodStart || stamp.slice(0, 7) + "-01",
      periodEnd: payload.periodEnd || stamp.slice(0, 10),
      basic,
      hra,
      allowances,
      deductions,
      pf,
      esi,
      tds,
      pt,
      grossPay,
      netPay,
      status: payload.status || "draft",
      approvedBy: "",
      components: JSON.stringify(payload.components || { basic, hra, allowances }),
      deductionsBreakup: JSON.stringify(payload.deductionsBreakup || { deductions, pf, esi, tds, pt }),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_payroll_components
        (id, tenantId, branchId, staffId, periodStart, periodEnd, basic, hra, allowances, deductions, pf, esi, tds, pt, grossPay, netPay, status, approvedBy, components, deductionsBreakup, createdAt, updatedAt)
      VALUES
        (@id, @tenantId, @branchId, @staffId, @periodStart, @periodEnd, @basic, @hra, @allowances, @deductions, @pf, @esi, @tds, @pt, @grossPay, @netPay, @status, @approvedBy, @components, @deductionsBreakup, @createdAt, @updatedAt)
    `).run(row);
    return mapJson(row, ["components", "deductionsBreakup"]);
  }

  createCommissionRule(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    const stamp = now();
    const row = {
      id: makeId("comm_rule"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      name: payload.name || "Commission rule",
      status: payload.status || "active",
      servicePercent: Number(payload.servicePercent || 0),
      productPercent: Number(payload.productPercent || 0),
      membershipPercent: Number(payload.membershipPercent || 0),
      packagePercent: Number(payload.packagePercent || 0),
      flatAmount: Number(payload.flatAmount || 0),
      targetBonus: Number(payload.targetBonus || 0),
      slabs: JSON.stringify(payload.slabs || []),
      rules: JSON.stringify(payload.rules || {}),
      approvedBy: "",
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_commission_rules
        (id, tenantId, branchId, staffId, name, status, servicePercent, productPercent, membershipPercent, packagePercent, flatAmount, targetBonus, slabs, rules, approvedBy, createdAt, updatedAt)
      VALUES
        (@id, @tenantId, @branchId, @staffId, @name, @status, @servicePercent, @productPercent, @membershipPercent, @packagePercent, @flatAmount, @targetBonus, @slabs, @rules, @approvedBy, @createdAt, @updatedAt)
    `).run(row);
    return mapJson(row, ["slabs", "rules"]);
  }

  createDocument(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    const stamp = now();
    const row = {
      id: makeId("staff_doc"),
      tenant_id: access.tenantId,
      staff_id: staff.id,
      document_type: payload.documentType || "document",
      document_url: payload.documentUrl || "",
      verification_status: payload.status || "pending",
      expiry_date: payload.expiresAt || "",
      uploaded_at: stamp,
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      documentType: payload.documentType || "document",
      documentNumber: payload.documentNumber || "",
      status: payload.status || "pending",
      issuedAt: payload.issuedAt || "",
      expiresAt: payload.expiresAt || "",
      verifiedBy: payload.status === "verified" ? access.userId || access.role || "" : "",
      notes: payload.notes || "",
      metadata: JSON.stringify(payload.metadata || {}),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_documents
        (id, tenant_id, staff_id, document_type, document_url, verification_status, expiry_date, uploaded_at, tenantId, branchId, staffId, documentType, documentNumber, status, issuedAt, expiresAt, verifiedBy, notes, metadata, createdAt, updatedAt)
      VALUES
        (@id, @tenant_id, @staff_id, @document_type, @document_url, @verification_status, @expiry_date, @uploaded_at, @tenantId, @branchId, @staffId, @documentType, @documentNumber, @status, @issuedAt, @expiresAt, @verifiedBy, @notes, @metadata, @createdAt, @updatedAt)
    `).run(row);
    return mapJson(row, ["metadata"]);
  }

  uploadDocument(id, payload = {}, access) {
    const row = recordById("staff_documents", id, access);
    const metadata = parseJson(row.metadata, {});
    metadata.file = {
      fileName: payload.fileName || "document",
      mimeType: payload.mimeType || "application/octet-stream",
      sizeBytes: Buffer.from(String(payload.contentBase64 || ""), "base64").length,
      stored: false,
      uploadedAt: now()
    };
    db.prepare("UPDATE staff_documents SET metadata = ?, updatedAt = ? WHERE id = ? AND tenantId = ?")
      .run(JSON.stringify(metadata), now(), id, access.tenantId);
    return mapJson(recordById("staff_documents", id, access), ["metadata"]);
  }

  createSkill(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    const stamp = now();
    const serviceIds = payload.serviceIds || [];
    const row = {
      id: makeId("skill"),
      tenant_id: access.tenantId,
      staff_id: staff.id,
      service_id: payload.serviceId || serviceIds[0] || makeId("service"),
      skill_level: payload.level || "beginner",
      years_experience: Number(payload.yearsExperience || 0),
      certified: payload.certificationStatus === "certified" ? 1 : 0,
      certification_expiry: payload.expiresAt || "",
      created_at: stamp,
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      skillName: payload.skillName || "Salon skill",
      level: payload.level || "beginner",
      serviceIds: JSON.stringify(serviceIds),
      certificationStatus: payload.certificationStatus || "pending",
      certifications: JSON.stringify(payload.certifications || []),
      expiresAt: payload.expiresAt || "",
      notes: payload.notes || "",
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_skills
        (id, tenant_id, staff_id, service_id, skill_level, years_experience, certified, certification_expiry, notes, created_at, tenantId, branchId, staffId, skillName, level, serviceIds, certificationStatus, certifications, expiresAt, createdAt, updatedAt)
      VALUES
        (@id, @tenant_id, @staff_id, @service_id, @skill_level, @years_experience, @certified, @certification_expiry, @notes, @created_at, @tenantId, @branchId, @staffId, @skillName, @level, @serviceIds, @certificationStatus, @certifications, @expiresAt, @createdAt, @updatedAt)
    `).run(row);
    return mapJson(row, ["serviceIds", "certifications"]);
  }

  createReview(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    const stamp = now();
    const row = {
      id: makeId("staff_review"),
      tenant_id: access.tenantId,
      staff_id: staff.id,
      customer_id: payload.clientId || "",
      review_text: payload.feedback || "",
      sentiment: payload.sentiment || "",
      created_at: stamp,
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      clientId: payload.clientId || "",
      appointmentId: payload.appointmentId || "",
      rating: Number(payload.rating || 0),
      feedback: payload.feedback || "",
      complaintFlag: payload.complaintFlag ? 1 : 0,
      rebookingFlag: payload.rebookingFlag ? 1 : 0,
      metadata: JSON.stringify(payload.metadata || {}),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_reviews
        (id, tenant_id, staff_id, customer_id, rating, review_text, sentiment, created_at, tenantId, branchId, staffId, clientId, appointmentId, feedback, complaintFlag, rebookingFlag, metadata, createdAt, updatedAt)
      VALUES
        (@id, @tenant_id, @staff_id, @customer_id, @rating, @review_text, @sentiment, @created_at, @tenantId, @branchId, @staffId, @clientId, @appointmentId, @feedback, @complaintFlag, @rebookingFlag, @metadata, @createdAt, @updatedAt)
    `).run(row);
    return mapJson(row, ["metadata"]);
  }

  createNotificationDraft(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const branchId = payload.branchId || staff.branchId || "";
    branchAccess(access, branchId);
    const type = payload.type || "shift_reminder";
    const stamp = now();
    const body = payload.body || `Hi ${staff.name}, this is a ${type.replaceAll("_", " ")} draft from Aura Salon.`;
    const row = {
      id: makeId("staff_note"),
      tenantId: access.tenantId,
      branchId,
      staffId: staff.id,
      type,
      channel: payload.channel || "whatsapp",
      title: payload.title || type.replaceAll("_", " "),
      body,
      status: "draft",
      payload: JSON.stringify({ manualApprovalRequired: true, sent: false }),
      copiedAt: "",
      approvedAt: "",
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_notifications
        (id, tenantId, branchId, staffId, type, channel, title, body, status, payload, copiedAt, approvedAt, createdAt, updatedAt)
      VALUES
        (@id, @tenantId, @branchId, @staffId, @type, @channel, @title, @body, @status, @payload, @copiedAt, @approvedAt, @createdAt, @updatedAt)
    `).run(row);
    staffWebPushService.queueStaffNotification(row);
    realtimeService.broadcast("staff-self.notification", { id: row.id, staffId: row.staffId, status: row.status }, { tenantId: row.tenantId, branchId: row.branchId });
    return mapJson(row, ["payload"]);
  }

  markNotificationCopied(id, access) {
    const row = recordById("staff_notifications", id, access);
    const stamp = now();
    db.prepare("UPDATE staff_notifications SET status = 'copied', copiedAt = ?, updatedAt = ? WHERE id = ? AND tenantId = ?")
      .run(stamp, stamp, id, access.tenantId);
    return mapJson(recordById("staff_notifications", id, access), ["payload"]);
  }

  sendNotificationWhatsapp(id, access) {
    const row = recordById("staff_notifications", id, access);
    return {
      ...mapJson(row, ["payload"]),
      sent: false,
      providerConfigured: false,
      message: "WhatsApp provider is not configured; draft remains manual-copy only."
    };
  }

  createTransfer(payload = {}, access) {
    const staff = staffRow(payload.staffId, access);
    const fromBranchId = payload.fromBranchId || staff.branchId || "";
    const toBranchId = payload.toBranchId || "";
    branchAccess(access, fromBranchId);
    branchAccess(access, toBranchId);
    if (!toBranchId) throw badRequest("toBranchId is required");
    const stamp = now();
    const row = {
      id: makeId("transfer"),
      tenantId: access.tenantId,
      branchId: fromBranchId,
      staffId: staff.id,
      fromBranchId,
      toBranchId,
      effectiveDate: payload.effectiveDate || stamp.slice(0, 10),
      reason: payload.reason || "",
      status: "pending",
      approvedBy: "",
      history: JSON.stringify([{ at: stamp, status: "pending", role: access.role }]),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO staff_branch_transfers
        (id, tenantId, branchId, staffId, fromBranchId, toBranchId, effectiveDate, reason, status, approvedBy, history, createdAt, updatedAt)
      VALUES
        (@id, @tenantId, @branchId, @staffId, @fromBranchId, @toBranchId, @effectiveDate, @reason, @status, @approvedBy, @history, @createdAt, @updatedAt)
    `).run(row);
    insertApproval({ requestType: "branch_transfer", referenceId: row.id, staffId: staff.id, branchId: fromBranchId, status: "pending", reason: payload.reason, access });
    return mapJson(row, ["history"]);
  }

  approveTransfer(id, access) {
    requireManager(access);
    const row = recordById("staff_branch_transfers", id, access);
    branchAccess(access, row.toBranchId || "");
    const stamp = now();
    const history = parseJson(row.history, []);
    history.push({ at: stamp, status: "approved", role: access.role });
    db.transaction(() => {
      db.prepare(`
        UPDATE staff_branch_transfers
        SET status = 'approved', approvedBy = ?, history = ?, updatedAt = ?
        WHERE id = ? AND tenantId = ?
      `).run(access.userId || access.role || "", JSON.stringify(history), stamp, id, access.tenantId);
      db.prepare("UPDATE staff SET branchId = ?, updatedAt = ? WHERE id = ? AND tenantId = ?")
        .run(row.toBranchId, stamp, row.staffId, access.tenantId);
    })();
    insertApproval({ requestType: "branch_transfer", referenceId: id, staffId: row.staffId, branchId: row.toBranchId, status: "approved", access });
    return mapJson(recordById("staff_branch_transfers", id, access), ["history"]);
  }

  payslipPdf(id, access) {
    const row = recordById("staff_payroll_components", id, access);
    const staff = staffRow(row.staffId, access);
    const body = [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj",
      `4 0 obj << /Length 95 >> stream\nBT /F1 14 Tf 72 720 Td (Aura Payslip ${staff.name} Net INR ${Math.round(row.netPay)}) Tj ET\nendstream endobj`,
      "xref\n0 5\n0000000000 65535 f \ntrailer << /Root 1 0 R /Size 5 >>",
      "startxref\n0\n%%EOF"
    ].join("\n");
    return Buffer.from(body, "utf8");
  }
}

export const staffEnterpriseService = new StaffEnterpriseService();
