import { db } from "../db.js";
import { staffOsService } from "./staff-os.service.js";
import { staffLoginService } from "./staff-login.service.js";
import { staffEnterpriseService } from "./staff-enterprise.service.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";

const text = (value) => String(value ?? "").trim();
const integer = (value, fallback = 0, max = 500) => Math.min(Math.max(Number.parseInt(String(value ?? fallback), 10) || fallback, 0), max);
const paise = (value) => Math.round(Number(value || 0) * 100);
const availability = (available, reason = null) => ({ available, reason });
const parseJson = (value, fallback = {}) => { try { return value && typeof value === "object" ? value : JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } };
const jsonObject = (value) => { try { const parsed = value && typeof value === "object" ? value : JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };

function pageParams(query = {}, defaultLimit = 50) {
  const limit = integer(query.limit, defaultLimit, 200) || defaultLimit;
  const offset = integer(query.offset, 0, 1000000);
  return { limit, offset };
}

function branchFilter(branches, params, column) {
  const slots = branches.map((branch, index) => { params[`scopeBranch${index}`] = branch.id; return `@scopeBranch${index}`; });
  return `${column} IN (${slots.join(",")})`;
}

function page(items, total, limit, offset) {
  return { items, page: { total, limit, offset, hasMore: offset + items.length < total } };
}

function istBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseBranches(value) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? [...new Set(parsed.map(text).filter(Boolean))] : []; }
  catch { return []; }
}

function ownerScope(access, requested = "all") {
  if (text(access?.role).toLowerCase() !== "owner") throw forbidden("Owner role is required");
  const owner = db.prepare(`SELECT role, status, branchIds FROM tenant_users WHERE tenantId = @tenantId AND id = @userId`)
    .get({ tenantId: access.tenantId, userId: access.userId });
  if (!owner || text(owner.role).toLowerCase() !== "owner" || text(owner.status).toLowerCase() !== "active") throw forbidden("Active owner access is required");
  const assigned = parseBranches(owner.branchIds);
  if (!assigned.length) throw forbidden("This owner has no assigned branches");
  const params = { tenantId: access.tenantId };
  const slots = assigned.map((id, index) => { params[`branch${index}`] = id; return `@branch${index}`; });
  const rows = db.prepare(`SELECT id, name FROM branches WHERE tenantId = @tenantId AND id IN (${slots.join(",")}) ORDER BY name`).all(params);
  const wanted = text(requested || "all");
  if (!wanted || wanted.toLowerCase() === "all") return rows;
  const branch = rows.find((row) => row.id === wanted);
  if (!branch) throw forbidden("The requested branch is not accessible to this owner");
  return [branch];
}

function scopedAccess(access, branchId) {
  return { ...access, role: "manager", branchId, requestedBranchId: branchId };
}

function staffBranch(staffId, access) {
  const modern = db.prepare(`SELECT branch_id AS branchId FROM staff_master WHERE tenant_id = @tenantId AND id = @staffId`).get({ tenantId: access.tenantId, staffId });
  const legacy = modern || db.prepare(`SELECT branchId FROM staff WHERE tenantId = @tenantId AND id = @staffId`).get({ tenantId: access.tenantId, staffId });
  if (!legacy) throw notFound("Staff record not found");
  ownerScope(access, legacy.branchId);
  return legacy.branchId;
}

function entityBranch(table, id, access) {
  const row = db.prepare(`SELECT branch_id AS branchId FROM ${table} WHERE tenant_id = @tenantId AND id = @id`).get({ tenantId: access.tenantId, id });
  if (!row) throw notFound("Record not found");
  if (row.branchId) ownerScope(access, row.branchId);
  return row.branchId;
}

function uniqueRows(rows) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function moneyPayroll(row) {
  const result = { ...row };
  for (const key of ["grossAmount", "deductionsAmount", "netAmount", "basicAmount", "overtimeAmount", "commissionAmount", "incentiveAmount", "allowanceAmount", "pfAmount", "esicAmount", "tdsAmount", "ptAmount"]) {
    if (result[key] === undefined && result[`${key}Paise`] === undefined) continue;
    const amountPaise = result[`${key}Paise`] !== undefined
      ? Math.round(Number(result[`${key}Paise`]) || 0)
      : result.sourceMoneyStorageUnit === "paise" || (!result.sourceMoneyStorageUnit && result.payrollContractVersion >= 2)
        ? Math.round(Number(result[key]) || 0)
        : paise(result[key]);
    result[`${key}Paise`] = amountPaise;
    delete result[key];
  }
  result.moneyStorageUnit = "paise";
  result.payrollContractVersion = 2;
  return result;
}

function ownerPayrollItem(row) {
  const statutory = jsonObject(row.statutoryJson);
  const storedAsPaise = row.sourceMoneyStorageUnit
    ? row.sourceMoneyStorageUnit === "paise"
    : statutory.storageUnit === "paise";
  const columnPaise = (explicitKey, rawValue) => row[explicitKey] !== undefined
    ? Math.round(Number(row[explicitKey]) || 0)
    : storedAsPaise ? Math.round(Number(rawValue) || 0) : paise(rawValue);
  return {
    id: row.id,
    branchId: row.branchId,
    staffId: row.staffId,
    salaryType: row.salaryType || "fixed",
    status: row.status || "draft",
    version: Number(row.version || 1),
    moneyStorageUnit: "paise",
    sourceMoneyStorageUnit: storedAsPaise ? "paise" : "legacy_rupees",
    payrollContractVersion: 2,
    grossAmountPaise: columnPaise("grossAmountPaise", row.grossAmount),
    overtimeAmountPaise: row.overtimeAmountPaise !== undefined
      ? Math.round(Number(row.overtimeAmountPaise) || 0)
      : row.overtimeAmount !== undefined ? columnPaise("overtimeAmountPaise", row.overtimeAmount) : paise(statutory.overtimeAmount),
    overtimeMinutes: Number(statutory.overtimeMinutes || 0),
    bonusAmountPaise: statutory.bonusAmount !== undefined ? paise(statutory.bonusAmount) : columnPaise("bonusAmountPaise", row.bonusAmount),
    bonusAccrualPaise: paise(statutory.bonusAccrual),
    deductionsAmountPaise: columnPaise("deductionAmountPaise", row.deductionAmount),
    netAmountPaise: columnPaise("netAmountPaise", row.netAmount),
    pfAmountPaise: paise(statutory.pf),
    esicAmountPaise: paise(statutory.esicEmployee ?? statutory.esic),
    esicEmployerAmountPaise: paise(statutory.esicEmployer),
    tdsAmountPaise: paise(statutory.tds),
    ptAmountPaise: paise(statutory.professionalTax),
    salarySource: text(statutory.salarySource),
    hasStatutoryData: Object.keys(statutory).length > 0
  };
}

function capabilities(actions, unavailable = {}) {
  return { actions, unavailable };
}

export class OwnerPeopleService {
  listStaff(access, query = {}) {
    const branches = ownerScope(access, query.branchId);
    const { limit, offset } = pageParams(query);
    const params = { tenantId: access.tenantId, q: `%${text(query.search || query.q).toLowerCase()}%`, role: text(query.role), employmentStatus: text(query.employmentStatus), status: text(query.status), loginStatus: text(query.loginStatus), attendanceStatus: text(query.attendanceStatus), from: text(query.from), to: text(query.to), limit, offset };
    const modernScope = branchFilter(branches, params, "sm.branch_id");
    const legacyScope = branchFilter(branches, params, "s.branchId");
    const sql = `WITH candidates AS (
      SELECT sm.id, sm.branch_id AS branchId, sm.full_name AS fullName, sm.mobile, sm.email, sm.employee_code AS employeeCode,
        sm.status, sm.role_id AS roleId, sm.designation, sm.employment_type AS employmentType
      FROM staff_master sm WHERE sm.tenant_id = @tenantId AND ${modernScope}
      UNION ALL
      SELECT s.id, s.branchId, s.name, s.phone, s.email, s.id, s.status, 'staff', s.role, ''
      FROM staff s WHERE s.tenantId = @tenantId AND ${legacyScope}
        AND NOT EXISTS (SELECT 1 FROM staff_master sm WHERE sm.tenant_id = @tenantId AND sm.id = s.id)
    ), decorated AS (
      SELECT c.*,
        COALESCE((SELECT tu.status FROM tenant_users tu WHERE tu.tenantId = @tenantId AND tu.staffId = c.id ORDER BY tu.updatedAt DESC LIMIT 1), '') AS loginStatus,
        COALESCE((SELECT a.status FROM staff_attendance_logs a WHERE a.tenant_id = @tenantId AND a.branch_id = c.branchId AND a.staff_id = c.id
          AND (@from = '' OR a.business_date >= @from) AND (@to = '' OR a.business_date <= @to) ORDER BY a.business_date DESC, a.created_at DESC LIMIT 1), 'not-recorded') AS attendanceStatus,
        COALESCE((SELECT SUM(sds.revenue_generated) FROM staff_daily_summary sds WHERE sds.tenant_id = @tenantId AND sds.staff_id = c.id
          AND (@from = '' OR sds.date >= @from) AND (@to = '' OR sds.date <= @to)), 0) AS businessGenerated
      FROM candidates c
    )`;
    const filters = ["(@q = '%%' OR lower(fullName || ' ' || mobile || ' ' || email || ' ' || employeeCode) LIKE @q)", "(@role = '' OR roleId = @role OR designation = @role)", "(@employmentStatus = '' OR employmentType = @employmentStatus)", "(@status = '' OR status = @status)", "(@loginStatus = '' OR (@loginStatus = 'enabled' AND loginStatus = 'active') OR (@loginStatus <> 'enabled' AND loginStatus <> 'active'))", "(@attendanceStatus = '' OR attendanceStatus = @attendanceStatus)"];
    const where = filters.join(" AND ");
    const total = Number(db.prepare(`${sql} SELECT COUNT(*) AS total FROM decorated WHERE ${where}`).get(params).total);
    const selected = db.prepare(`${sql} SELECT id, branchId, attendanceStatus, businessGenerated FROM decorated WHERE ${where} ORDER BY lower(fullName), id LIMIT @limit OFFSET @offset`).all(params);
    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
    const items = selected.map((selectedRow) => ({ ...staffOsService.getStaff(selectedRow.id, scopedAccess(access, selectedRow.branchId)), branchName: branchNames.get(selectedRow.branchId) || "", attendanceStatus: selectedRow.attendanceStatus, businessPaise: Math.round(Number(selectedRow.businessGenerated || 0) * 100) }));
    const optionParams = { tenantId: access.tenantId }; const optionModernScope = branchFilter(branches, optionParams, "branch_id"); const optionLegacyScope = branchFilter(branches, optionParams, "branchId");
    const optionRows = db.prepare(`SELECT role, employmentType FROM (
      SELECT COALESCE(NULLIF(designation,''), role_id) AS role, employment_type AS employmentType FROM staff_master WHERE tenant_id=@tenantId AND ${optionModernScope}
      UNION SELECT role, '' FROM staff WHERE tenantId=@tenantId AND ${optionLegacyScope})`).all(optionParams);
    return { ...page(items, total, limit, offset), filters: { roles: [...new Set(optionRows.map((row) => row.role).filter(Boolean))].sort(), employments: [...new Set(optionRows.map((row) => row.employmentType).filter(Boolean))].sort() }, availability: { directory: availability(true), salary: availability(true), activity: availability(true) }, capabilities: capabilities(["create", "update", "status", "login", "role", "branchTransfer", "schedule", "commission"]) };
  }

  staffDetail(id, access, query = {}) {
    const branchId = staffBranch(id, access); const scoped = scopedAccess(access, branchId);
    const staff = staffOsService.getStaff(id, scoped); const from = text(query.from); const to = text(query.to);
    const schedules = staffOsService.listSchedules({ staffId: id, branchId, from, to, limit: 200 }, scoped);
    const attendance = staffOsService.listAttendance({ staffId: id, branchId, from, to, limit: 200 }, scoped);
    const leaves = staffOsService.listLeaves({ staffId: id, branchId, from, to, limit: 100 }, scoped);
    const commissions = staffOsService.listCommissions({ branchId, limit: 200 }, scoped).filter((row) => row.staffId === id).map((row) => { const normalized = { ...row, baseAmountPaise: paise(row.baseAmount), commissionAmountPaise: paise(row.commissionAmount) }; delete normalized.baseAmount; delete normalized.commissionAmount; return normalized; });
    const payroll = db.prepare(`SELECT * FROM staff_payroll_items WHERE tenant_id = @tenantId AND branch_id = @branchId AND staff_id = @staffId ORDER BY created_at DESC LIMIT 24`).all({ tenantId: access.tenantId, branchId, staffId: id }).map((row) => ownerPayrollItem(Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]))));
    const appointments = db.prepare(`SELECT id, startAt, endAt, status FROM appointments WHERE tenantId = @tenantId AND branchId = @branchId AND staffId = @staffId AND (@from = '' OR substr(startAt,1,10) >= @from) AND (@to = '' OR substr(startAt,1,10) <= @to) ORDER BY startAt DESC LIMIT 100`).all({ tenantId: access.tenantId, branchId, staffId: id, from, to });
    const activity = db.prepare(`SELECT id, action, entity_type AS entityType, entity_id AS entityId, created_at AS createdAt FROM staff_audit_logs WHERE tenant_id = @tenantId AND branch_id = @branchId AND entity_id = @staffId ORDER BY created_at DESC LIMIT 40`).all({ tenantId: access.tenantId, branchId, staffId: id });
    const revenueRow = db.prepare(`SELECT COALESCE(SUM(sds.revenue_generated), 0) AS totalRevenue, COALESCE(SUM(sds.services_completed), 0) AS totalServices, COALESCE(SUM(sds.tips_received), 0) AS totalTips FROM staff_daily_summary sds WHERE sds.tenant_id = @tenantId AND sds.staff_id = @staffId AND (@from = '' OR sds.date >= @from) AND (@to = '' OR sds.date <= @to)`).get({ tenantId: access.tenantId, staffId: id, from, to });
    const dailyRevenue = db.prepare(`SELECT sds.date, sds.revenue_generated AS revenue, sds.services_completed AS services, sds.tips_received AS tips FROM staff_daily_summary sds WHERE sds.tenant_id = @tenantId AND sds.staff_id = @staffId AND (@from = '' OR sds.date >= @from) AND (@to = '' OR sds.date <= @to) ORDER BY sds.date DESC LIMIT 31`).all({ tenantId: access.tenantId, staffId: id, from, to }).map((row) => ({ date: row.date, revenuePaise: Math.round(Number(row.revenue || 0) * 100), services: Number(row.services || 0), tipsPaise: Math.round(Number(row.tips || 0) * 100) }));
    const details = staff.employeeDetails ? { ...staff.employeeDetails, attendanceSalary: Object.fromEntries(Object.entries(staff.employeeDetails.attendanceSalary || {}).map(([key, value]) => [key.toLowerCase().includes("salary") || key.toLowerCase().includes("rate") ? `${key}Paise` : key, key.toLowerCase().includes("salary") || key.toLowerCase().includes("rate") ? paise(value) : value])) } : null;
    return { staff: { ...staff, employeeDetails: details }, sections: { schedules, attendance, appointments, performance: availability(false, "No dedicated owner-safe performance detail contract is available"), salary: details?.attendanceSalary || null, commissions, payroll, leaves, access: staffLoginService.getStaffLogin(id, scoped), activity, revenue: { totalPaise: Math.round(Number(revenueRow.totalRevenue || 0) * 100), totalServices: Number(revenueRow.totalServices || 0), totalTipsPaise: Math.round(Number(revenueRow.totalTips || 0) * 100), daily: dailyRevenue } }, availability: { overview: availability(true), schedules: availability(true), attendance: availability(true), appointments: availability(true), performance: availability(false, "Source unavailable"), salary: availability(Boolean(details)), commissions: availability(true), payroll: availability(true), leaves: availability(true), access: availability(true), activity: availability(true), revenue: availability(true) }, capabilities: capabilities(["update", "status", "login", "role", "branchTransfer", "schedule", "commission"], { salaryRevision: "The existing revision contract is not safe to infer here", shiftEdit: "Only schedule creation is exposed" }) };
  }

  createStaff(body, access) { const branch = ownerScope(access, body.branchId)[0]; return staffOsService.createStaff({ ...body, branchId: branch.id }, scopedAccess(access, branch.id)); }
  updateStaff(id, body, access) { const branchId = staffBranch(id, access); if (text(body.branchId) && text(body.branchId) !== branchId) throw badRequest("Use the staff transfer workflow to change branches"); return staffOsService.updateStaff(id, { ...body, branchId }, scopedAccess(access, branchId)); }
  updateStatus(id, body, access) { const branchId = staffBranch(id, access); return staffOsService.updateStaffStatus(id, body, scopedAccess(access, branchId)); }
  updateLogin(id, body, access) { const branchId = staffBranch(id, access); if (Array.isArray(body.branchIds)) body.branchIds.forEach((branch) => ownerScope(access, branch)); return staffLoginService.upsertStaffLogin(id, body, { ...scopedAccess(access, branchId), role: "owner" }); }
  transfer(id, body, access) { const branchId = staffBranch(id, access); ownerScope(access, body.toBranchId); return staffOsService.branchTransfer({ ...body, staffId: id }, scopedAccess(access, branchId)); }
  createSchedule(id, body, access) { const branchId = staffBranch(id, access); const target = text(body.branchId || branchId); ownerScope(access, target); return staffOsService.createSchedule({ ...body, staffId: id, branchId: target }, scopedAccess(access, target)); }
  calculateCommission(id, body, access) { const branchId = staffBranch(id, access); const { baseAmountPaise = 0, ...safeBody } = body; const result = staffOsService.calculateCommission({ ...safeBody, baseAmount: Number(baseAmountPaise) / 100, staffId: id, branchId }, scopedAccess(access, branchId)); const normalized = { ...result, baseAmountPaise: paise(result.baseAmount), commissionAmountPaise: paise(result.commissionAmount) }; delete normalized.baseAmount; delete normalized.commissionAmount; return normalized; }
  approveCommission(id, access) { const branchId = entityBranch("staff_commissions", id, access); return staffOsService.approveCommission(id, { ...scopedAccess(access, branchId), role: "owner" }); }

  attendance(access, query = {}) {
    const branches = ownerScope(access, query.branchId); const from = text(query.from); const to = text(query.to);
    const staff = uniqueRows(branches.flatMap((branch) => staffOsService.listStaff({ branchId: branch.id, status: "active", limit: 500 }, scopedAccess(access, branch.id))));
    const names = new Map(staff.map((row) => [row.id, row.fullName]));
    const rows = branches.flatMap((branch) => staffOsService.listAttendance({ branchId: branch.id, staffId: query.staffId, from, to, limit: 500 }, scopedAccess(access, branch.id))).map((row) => ({ ...row, staffName: names.get(row.staffId) || "Staff", branchName: branches.find((branch) => branch.id === row.branchId)?.name || "", attendanceStatus: row.status, missingClockOut: row.status === "clocked_in" && row.businessDate < to }));
    const attendanceIds = new Set(rows.map((row) => row.id));
    const corrections = db.prepare(`SELECT attendance_id AS attendanceId, status FROM attendance_corrections WHERE tenant_id = @tenantId AND created_at >= @fromStamp`).all({ tenantId: access.tenantId, fromStamp: from ? `${from}T00:00:00` : "" }).filter((row) => attendanceIds.has(row.attendanceId));
    const summary = { scheduled: 0, present: rows.length, clockedIn: rows.filter((row) => row.status === "clocked_in").length, late: rows.filter((row) => Number(row.lateMinutes || 0) > 0).length, break: rows.filter((row) => row.activeBreak).length, absent: 0, leave: 0, clockedOut: rows.filter((row) => row.status === "clocked_out").length, overtime: rows.filter((row) => Number(row.overtimeMinutes || 0) > 0).length, missingClockOut: rows.filter((row) => row.missingClockOut).length, corrections: corrections.length };
    return { items: rows, summary, views: ["today", "timeline", "monthly", "staff", "branch", "exceptions"], availability: { livePresence: availability(false, "Attendance is based on saved punches, not live presence"), late: availability(rows.some((row) => row.lateMinutes !== undefined), "Late minutes are not stored on every record"), absence: availability(false, "Absence cannot be derived safely without complete roster coverage") }, capabilities: capabilities(["correction"]) };
  }
  attendanceDetail(id, access) { const branchId = entityBranch("staff_attendance_logs", id, access); const row = staffOsService.listAttendance({ branchId, limit: 500 }, scopedAccess(access, branchId)).find((item) => item.id === id); if (!row) throw notFound("Attendance record not found"); return { attendance: row, capabilities: capabilities(["correction"]) }; }
  correctAttendance(id, body, access) { const branchId = entityBranch("staff_attendance_logs", id, access); if (!text(body.reason)) throw badRequest("A correction reason is required"); return staffOsService.correctAttendance({ ...body, attendanceId: id }, { ...scopedAccess(access, branchId), role: "owner" }); }

  leaves(access, query = {}) {
    const branches = ownerScope(access, query.branchId); const { limit, offset } = pageParams(query);
    const params = { tenantId: access.tenantId, from: text(query.from), to: text(query.to), q: `%${text(query.search || query.q).toLowerCase()}%`, view: text(query.view || query.status).toLowerCase(), today: istBusinessDate(), limit, offset };
    const modernScope = branchFilter(branches, params, "l.branch_id");
    const requestScope = branchFilter(branches, params, "r.branchId");
    const candidates = `WITH candidates AS (
      SELECT l.id,l.branch_id AS branchId,l.staff_id AS staffId,l.leave_type AS leaveType,l.start_date AS startDate,l.end_date AS endDate,MAX(1,CAST(julianday(l.end_date)-julianday(l.start_date)+1 AS INTEGER)) AS days,l.reason,l.status,l.rejection_reason AS rejectionReason,l.approved_at AS approvedAt,l.version,l.created_at AS createdAt
      FROM staff_leaves l WHERE l.tenant_id=@tenantId AND ${modernScope}
      UNION ALL
      SELECT r.id,r.branchId,r.staffId,r.leaveType,r.startDate,r.endDate,COALESCE(r.days,1),r.reason,r.status,r.decisionReason,NULL,r.version,r.createdAt
      FROM staff_leave_requests r WHERE r.tenantId=@tenantId AND ${requestScope} AND NOT EXISTS (SELECT 1 FROM staff_leaves linked WHERE linked.tenant_id=r.tenantId AND linked.id=r.id)
    ), decorated AS (
      SELECT c.*,COALESCE(sm.full_name,s.name,'Staff') AS staffName FROM candidates c
      LEFT JOIN staff_master sm ON sm.tenant_id=@tenantId AND sm.id=c.staffId
      LEFT JOIN staff s ON s.tenantId=@tenantId AND s.id=c.staffId
    )`;
    const where = `(@from='' OR endDate>=@from) AND (@to='' OR startDate<=@to) AND (@q='%%' OR lower(id || ' ' || staffName || ' ' || leaveType || ' ' || COALESCE(reason,'')) LIKE @q) AND (@view='' OR (@view='upcoming' AND status='approved' AND startDate>=@today) OR (@view='past' AND endDate<@today) OR (@view NOT IN ('upcoming','past') AND status=@view))`;
    const total = Number(db.prepare(`${candidates} SELECT COUNT(*) AS total FROM decorated WHERE ${where}`).get(params).total);
    const rows = db.prepare(`${candidates} SELECT * FROM decorated WHERE ${where} ORDER BY createdAt DESC,id LIMIT @limit OFFSET @offset`).all(params).map((row) => ({ ...row, documentAvailable: false }));
    return { ...page(rows, total, limit, offset), availability: { balances: availability(true), conflicts: availability(true), documents: availability(false, "Leave requests do not store document references") }, capabilities: capabilities(["approve", "reject"]) };
  }
  leaveDetail(id, access) { const modern = db.prepare(`SELECT branch_id AS branchId FROM staff_leaves WHERE tenant_id=@tenantId AND id=@id`).get({ tenantId: access.tenantId, id }); const request = db.prepare(`SELECT branchId,history FROM staff_leave_requests WHERE tenantId=@tenantId AND id=@id`).get({ tenantId: access.tenantId, id }); const branchId = modern?.branchId ?? request?.branchId; if (branchId === undefined) throw notFound("Leave request not found"); ownerScope(access, branchId); const scoped = scopedAccess(access, branchId); const leave = this.leaves(access, { branchId, search: id, limit: 200 }).items.find((row) => row.id === id); if (!leave) throw notFound("Leave request not found"); const balances = staffOsService.leaveBalances({ staffId: leave.staffId }, scoped); const conflicts = this.leaves(access, { branchId, from: leave.startDate, to: leave.endDate, view: "approved", limit: 200 }).items.filter((row) => row.id !== id); const history = request ? parseJson(request.history, []) : []; return { leave, balances, conflicts, history, availability: { history: availability(Boolean(request), request ? null : "A leave decision history source is not available"), documents: availability(false, "No document source") }, capabilities: capabilities(leave.status === "pending" ? ["approve", "reject"] : []) }; }
  decideLeave(id, decision, body, access) {
    const modern = db.prepare(`SELECT branch_id AS branchId,status FROM staff_leaves WHERE tenant_id=@tenantId AND id=@id`).get({ tenantId: access.tenantId, id });
    const request = db.prepare(`SELECT * FROM staff_leave_requests WHERE tenantId=@tenantId AND id=@id`).get({ tenantId: access.tenantId, id });
    const current = modern || request;
    if (!current) throw notFound("Leave request not found");
    ownerScope(access, current.branchId);
    if (current.status === decision) return this.leaveDetail(id, access).leave;
    if (current.status !== "pending") throw conflict("This leave request has already been decided");
    if (decision === "rejected" && !text(body.reason)) throw badRequest("A rejection reason is required");
    const scoped = scopedAccess(access, current.branchId);
    if (request) {
      const decide = db.transaction(() => {
        const canonical = db.prepare(`SELECT id,status,version FROM staff_leaves WHERE tenant_id=@tenantId AND id=@id`).get({ tenantId: access.tenantId, id });
        if (!canonical) db.prepare(`INSERT INTO staff_leaves (id,tenant_id,branch_id,staff_id,leave_type,start_date,end_date,reason,status,created_at,updated_at) VALUES (@id,@tenantId,@branchId,@staffId,@leaveType,@startDate,@endDate,@reason,'pending',@createdAt,@updatedAt)`).run({ id, tenantId: access.tenantId, branchId: request.branchId, staffId: request.staffId, leaveType: request.leaveType, startDate: request.startDate, endDate: request.endDate, reason: text(request.reason), createdAt: request.createdAt, updatedAt: request.updatedAt });
        const canonicalRow = db.prepare(`SELECT version FROM staff_leaves WHERE tenant_id=@tenantId AND id=@id`).get({ tenantId: access.tenantId, id });
        staffOsService.decideLeave(id, decision, { ...body, version: canonicalRow?.version }, scoped);
        staffEnterpriseService.decideLeave(id, decision, body, scoped);
      });
      decide();
    } else staffOsService.decideLeave(id, decision, body, scoped);
    return this.leaveDetail(id, access).leave;
  }

  payroll(access, query = {}) { const branches = ownerScope(access, query.branchId); const { limit, offset } = pageParams(query); const params = { tenantId: access.tenantId, status: text(query.status), from: text(query.from), to: text(query.to), q: `%${text(query.search || query.q).toLowerCase()}%`, limit, offset }; const scope = branchFilter(branches, params, "pr.branch_id"); const where = `pr.tenant_id=@tenantId AND ${scope} AND (@status='' OR pr.status=@status) AND (@from='' OR pr.period_end>=@from) AND (@to='' OR pr.period_start<=@to) AND (@q='%%' OR lower(pr.id || ' ' || pr.period_start || ' ' || pr.period_end) LIKE @q)`; const total = Number(db.prepare(`SELECT COUNT(*) AS total FROM staff_payroll_runs pr WHERE ${where}`).get(params).total); const rows = db.prepare(`SELECT pr.id,pr.branch_id AS branchId,pr.period_start AS periodStart,pr.period_end AS periodEnd,pr.status,pr.gross_amount AS grossAmount,pr.deductions_amount AS deductionsAmount,pr.net_amount AS netAmount,pr.version,pr.created_at AS createdAt,CASE WHEN EXISTS (SELECT 1 FROM staff_payroll_items pi WHERE pi.tenant_id=pr.tenant_id AND pi.payroll_run_id=pr.id AND pi.statutory_json LIKE '%\"storageUnit\":\"paise\"%') THEN 'paise' ELSE 'legacy_rupees' END AS sourceMoneyStorageUnit FROM staff_payroll_runs pr WHERE ${where} ORDER BY pr.created_at DESC,pr.id LIMIT @limit OFFSET @offset`).all(params).map(moneyPayroll); return { ...page(rows, total, limit, offset), availability: { compliance: availability(true), incentives: availability(false, "Only persisted payroll item fields are returned") }, capabilities: capabilities(["generate", "approve", "markPaid"]) }; }
  payrollDetail(id, access) { const branchId = entityBranch("staff_payroll_runs", id, access); const scoped = { ...scopedAccess(access, branchId), role: "accountant" }; const run = staffOsService.listPayroll({ branchId, limit: 200 }, scoped).find((row) => row.id === id); if (!run) throw notFound("Payroll run not found"); const items = staffOsService.payrollItems(id, scoped).map(ownerPayrollItem); const hasCompliance = items.some((item) => item.hasStatutoryData); const actions = run.status === "draft" ? ["approve"] : run.status === "approved" ? ["markPaid"] : []; return { run: moneyPayroll(run), items, capabilities: capabilities(actions), availability: { calculation: availability(true), compliance: availability(hasCompliance, hasCompliance ? null : "Compliance fields are returned only when persisted") } }; }
  generatePayroll(body, access) { const branch = ownerScope(access, body.branchId)[0]; if (!body.branchId || text(body.branchId).toLowerCase() === "all") throw badRequest("A single branch is required to generate payroll"); const generated = staffOsService.generatePayroll(body, { ...scopedAccess(access, branch.id), role: "owner" }); const { items = [], ...run } = generated; return { ...moneyPayroll(run), items: items.map(ownerPayrollItem) }; }
  approvePayroll(id, access) { const branchId = entityBranch("staff_payroll_runs", id, access); const detail = this.payrollDetail(id, access); if (detail.run.status !== "draft") throw conflict("Only draft payroll can be approved"); return moneyPayroll(staffOsService.approvePayroll(id, { ...scopedAccess(access, branchId), role: "owner" })); }
  markPayrollPaid(id, access) { const branchId = entityBranch("staff_payroll_runs", id, access); const detail = this.payrollDetail(id, access); if (detail.run.status !== "approved") throw conflict("Only approved payroll can be marked paid"); return moneyPayroll(staffOsService.markPayrollPaid(id, { ...scopedAccess(access, branchId), role: "owner" })); }
}

export const ownerPeopleService = new OwnerPeopleService();
