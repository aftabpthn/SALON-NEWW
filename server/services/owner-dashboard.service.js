import { db } from "../db.js";
import { badRequest, forbidden } from "../utils/app-error.js";

const DAY_MS = 86_400_000;
const MAX_CUSTOM_DAYS = 366;
const COMPLETED_APPOINTMENT_STATUSES = new Set(["completed", "billed", "paid"]);
const EXCLUDED_SALE_STATUSES = new Set(["cancelled", "canceled", "void", "refunded", "refund"]);

function dateParts(date) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function isoDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysInclusive(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function istToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseDate(value, field) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest(`${field} must use YYYY-MM-DD format`);
  const { year, month, day } = dateParts(date);
  if (isoDate(year, month, day) !== date) throw badRequest(`${field} is not a valid calendar date`);
  return date;
}

function resolveRanges(query = {}) {
  const key = String(query.range || "today").toLowerCase();
  const allowed = new Set(["today", "week", "month", "quarter", "year", "custom"]);
  if (!allowed.has(key)) throw badRequest("range must be today, week, month, quarter, year, or custom");

  const today = istToday();
  const { year, month } = dateParts(today);
  let from;
  let to;
  if (key === "custom") {
    if (!query.from || !query.to) throw badRequest("from and to are required when range=custom");
    from = parseDate(query.from, "from");
    to = parseDate(query.to, "to");
  } else {
    if (query.from || query.to) throw badRequest("from and to are supported only when range=custom");
    to = today;
    from = key === "today" ? today
      : key === "week" ? addDays(today, 1 - (new Date(`${today}T00:00:00Z`).getUTCDay() || 7))
      : key === "month" ? isoDate(year, month, 1)
      : key === "quarter" ? isoDate(year, Math.floor((month - 1) / 3) * 3 + 1, 1)
      : isoDate(year, 1, 1);
  }
  if (from > to) throw badRequest("from must be on or before to");
  const spanDays = daysInclusive(from, to);
  if (key === "custom" && spanDays > MAX_CUSTOM_DAYS) {
    throw badRequest(`Custom ranges cannot exceed ${MAX_CUSTOM_DAYS} calendar days`);
  }
  return {
    current: { key, from, to, spanDays, timezone: "Asia/Kolkata" },
    previous: { from: addDays(from, -spanDays), to: addDays(from, -1), spanDays, timezone: "Asia/Kolkata" }
  };
}

const tableColumnsCache = new Map();
function tableColumns(table) {
  let cols = tableColumnsCache.get(table);
  if (!cols) {
    cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    tableColumnsCache.set(table, cols);
  }
  return cols;
}

function hasColumns(table, required) {
  const columns = tableColumns(table);
  return required.every((column) => columns.has(column));
}

function branchClause(branchIds, column = "branchId", prefix = "branch") {
  const params = {};
  const names = branchIds.map((branchId, index) => {
    const name = `${prefix}${index}`;
    params[name] = branchId;
    return `@${name}`;
  });
  return { sql: `${column} IN (${names.join(", ")})`, params };
}

function businessDateSql(column) {
  return `CASE
    WHEN ${column} GLOB '*Z' OR ${column} GLOB '*[+-][0-9][0-9]:[0-9][0-9]'
      THEN date(${column}, '+5 hours', '+30 minutes')
    ELSE substr(${column}, 1, 10)
  END`;
}

function businessHourSql(column) {
  return `CASE
    WHEN ${column} GLOB '*Z' OR ${column} GLOB '*[+-][0-9][0-9]:[0-9][0-9]'
      THEN strftime('%H', ${column}, '+5 hours', '+30 minutes')
    ELSE substr(${column}, 12, 2)
  END`;
}

function paise(value) {
  return Math.round(Number(value || 0) * 100);
}

function percent(value) {
  return Math.round(value * 100) / 100;
}

function metadata(route, filters, source) {
  return {
    apiRoute: "/api/v1/owner-console/dashboard",
    filters: { ...filters, sourceRoute: route },
    sourceLabel: source
  };
}

function ownerDestination(route, filters) {
  return { route, filters };
}

function sourceTrace(_apiRoute, filters, sourceLabel) {
  return { apiRoute: "/api/v1/owner-console/dashboard", filters, sourceLabel };
}

function kpi(current, previous, unit, support, sparkline) {
  const absoluteDelta = previous === null ? null : current - previous;
  const percentDelta = previous === null || previous === 0 ? null : percent((absoluteDelta / previous) * 100);
  return {
    unit,
    current,
    previous,
    absoluteDelta,
    percentDelta,
    trend: previous === null ? "unavailable" : absoluteDelta > 0 ? "positive" : absoluteDelta < 0 ? "negative" : "flat",
    comparisonAvailable: previous !== null,
    availability: { available: true, reason: null },
    ...(sparkline?.length ? { sparkline } : {}),
    support
  };
}

function unavailableKpi(unit, support, reason) {
  return {
    unit,
    current: null,
    previous: null,
    absoluteDelta: null,
    percentDelta: null,
    trend: "unavailable",
    comparisonAvailable: false,
    availability: { available: false, reason },
    support
  };
}

function safeSource(key, availability, warnings, load, fallback) {
  try {
    const value = load();
    availability[key] = { available: true, partial: false, reason: null };
    return value;
  } catch (error) {
    availability[key] = { available: false, partial: false, reason: "Source query unavailable" };
    warnings.push({ source: key, code: "SOURCE_UNAVAILABLE", message: `${key} data is unavailable for this response` });
    return fallback;
  }
}

function loadBranches(tenantId, accessibleBranchIds) {
  if (!hasColumns("branches", ["id", "tenantId", "name", "city", "timezone", "status"])) {
    throw forbidden("Accessible branch metadata is unavailable");
  }
  const scope = branchClause(accessibleBranchIds, "id", "accessibleBranch");
  return db.prepare(`SELECT id, name, city, timezone, status
    FROM branches
    WHERE tenantId = @tenantId AND ${scope.sql}
    ORDER BY name, id`).all({ tenantId, ...scope.params });
}

function loadSales(tenantId, branchIds, ranges) {
  if (!hasColumns("sales", ["id", "tenantId", "branchId", "clientId", "subtotal", "discount", "gstAmount", "total", "status", "createdAt"])) {
    throw new Error("sales schema is incompatible");
  }
  const scope = branchClause(branchIds, "branchId", "saleBranch");
  const dateSql = businessDateSql("createdAt");
  return db.prepare(`SELECT id, branchId, clientId, subtotal, discount, gstAmount, total, status,
      ${dateSql} AS businessDate
    FROM sales
    WHERE tenantId = @tenantId AND ${scope.sql}
      AND ${dateSql} BETWEEN @from AND @to
    ORDER BY createdAt, id`).all({
    tenantId,
    ...scope.params,
    from: ranges.previous.from,
    to: ranges.current.to
  }).filter((row) => !EXCLUDED_SALE_STATUSES.has(String(row.status || "").toLowerCase()));
}

function loadAppointments(tenantId, branchIds, ranges) {
  if (!hasColumns("appointments", ["id", "tenantId", "branchId", "clientId", "staffId", "startAt", "endAt", "status", "source"])) {
    throw new Error("appointments schema is incompatible");
  }
  const scope = branchClause(branchIds, "branchId", "appointmentBranch");
  const dateSql = businessDateSql("startAt");
  const hourSql = businessHourSql("startAt");
  return db.prepare(`SELECT id, branchId, clientId, staffId, startAt, endAt, status, source,
      ${dateSql} AS businessDate, ${hourSql} AS businessHour
    FROM appointments
    WHERE tenantId = @tenantId AND ${scope.sql}
      AND ${dateSql} BETWEEN @from AND @to
    ORDER BY startAt, id`).all({
    tenantId,
    ...scope.params,
    from: ranges.previous.from,
    to: ranges.current.to
  });
}

function loadFirstCompletedVisits(tenantId, branchIds, clientIds) {
  if (!clientIds.length) return new Map();
  const branches = branchClause(branchIds, "branchId", "visitBranch");
  const clients = branchClause(clientIds, "clientId", "visitClient");
  const dateSql = businessDateSql("startAt");
  const rows = db.prepare(`SELECT clientId, MIN(${dateSql}) AS firstVisitDate
    FROM appointments
    WHERE tenantId = @tenantId AND ${branches.sql} AND ${clients.sql}
      AND lower(status) IN ('completed', 'billed', 'paid')
    GROUP BY clientId`).all({ tenantId, ...branches.params, ...clients.params });
  return new Map(rows.map((row) => [row.clientId, row.firstVisitDate]));
}

function loadInvoices(tenantId, branchIds, ranges, allOutstanding = false) {
  if (!hasColumns("invoices", ["id", "tenantId", "saleId", "invoiceNumber", "clientId", "balance", "status", "dueDate", "createdAt"])) {
    throw new Error("invoices schema is incompatible");
  }
  const scope = branchClause(branchIds, "s.branchId", "invoiceBranch");
  const dateSql = businessDateSql("i.createdAt");
  return db.prepare(`SELECT i.id, i.invoiceNumber, i.clientId, i.balance, i.status, i.dueDate,
      s.branchId, ${dateSql} AS businessDate
    FROM invoices i
    JOIN sales s ON s.id = i.saleId AND s.tenantId = i.tenantId
    WHERE i.tenantId = @tenantId AND ${scope.sql} AND i.balance > 0
      AND lower(i.status) NOT IN ('paid', 'void', 'cancelled', 'canceled')
      ${allOutstanding ? "" : `AND ${dateSql} BETWEEN @from AND @to`}
    ORDER BY i.dueDate, i.createdAt, i.id`).all({
    tenantId,
    ...scope.params,
    ...(allOutstanding ? {} : { from: ranges.previous.from, to: ranges.current.to })
  });
}

function rangeRows(rows, range) {
  return rows.filter((row) => row.businessDate >= range.from && row.businessDate <= range.to);
}

function salesMetrics(rows) {
  return {
    netRevenuePaise: rows.reduce((sum, row) => sum + paise(row.total), 0),
    grossSalesPaise: rows.reduce((sum, row) => sum + paise(row.subtotal), 0),
    discountsPaise: rows.reduce((sum, row) => sum + paise(row.discount), 0),
    taxesPaise: rows.reduce((sum, row) => sum + paise(row.gstAmount), 0),
    bills: rows.length
  };
}

function appointmentMetrics(rows, firstVisits, range) {
  const completed = rows.filter((row) => COMPLETED_APPOINTMENT_STATUSES.has(String(row.status || "").toLowerCase()));
  const completedClients = new Set(completed.map((row) => row.clientId).filter(Boolean));
  let newClients = 0;
  let returningClients = 0;
  for (const clientId of completedClients) {
    const firstVisit = firstVisits.get(clientId);
    if (!firstVisit) continue;
    if (firstVisit >= range.from && firstVisit <= range.to) newClients += 1;
    else if (firstVisit < range.from) returningClients += 1;
  }
  return { appointments: rows.length, completedAppointments: completed.length, newClients, returningClients };
}

function groupMode(spanDays) {
  return spanDays <= 31 ? "day" : spanDays <= 186 ? "week" : "month";
}

function bucketStart(date, mode) {
  if (mode === "day") return date;
  if (mode === "month") return `${date.slice(0, 7)}-01`;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function aggregateValue(current, previous, available = true, reason = null) {
  if (!available) {
    return {
      unit: "paise", current: null, previous: null, absoluteDelta: null, percentDelta: null,
      trend: "unavailable", comparisonAvailable: false, availability: { available: false, reason }
    };
  }
  const absoluteDelta = previous === null ? null : current - previous;
  return {
    unit: "paise",
    current,
    previous,
    absoluteDelta,
    percentDelta: previous === null || previous === 0 ? null : percent((absoluteDelta / previous) * 100),
    trend: previous === null ? "unavailable" : absoluteDelta > 0 ? "positive" : absoluteDelta < 0 ? "negative" : "flat",
    comparisonAvailable: previous !== null,
    availability: { available: true, reason: null }
  };
}

function revenueSeries(currentRows, previousRows, ranges, currentMetrics, previousMetrics, outstanding) {
  const grouping = groupMode(ranges.current.spanDays);
  const grouped = (rows) => {
    const values = new Map();
    for (const row of rows) {
      const bucket = bucketStart(row.businessDate, grouping);
      values.set(bucket, (values.get(bucket) || 0) + paise(row.total));
    }
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, netRevenuePaise]) => ({ bucket, netRevenuePaise }));
  };
  return {
    grouping,
    unit: "paise",
    current: grouped(currentRows),
    previous: grouped(previousRows),
    aggregates: {
      grossSalesPaise: aggregateValue(currentMetrics.grossSalesPaise, previousMetrics.grossSalesPaise),
      netRevenuePaise: aggregateValue(currentMetrics.netRevenuePaise, previousMetrics.netRevenuePaise),
      discountsPaise: aggregateValue(currentMetrics.discountsPaise, previousMetrics.discountsPaise),
      taxesPaise: aggregateValue(currentMetrics.taxesPaise, previousMetrics.taxesPaise),
      outstandingPaise: outstanding.available
        ? aggregateValue(outstanding.current, outstanding.previous)
        : aggregateValue(null, null, false, "Invoice source unavailable"),
      refundsPaise: aggregateValue(null, null, false, "No authoritative scoped refund source is available"),
      serviceRevenuePaise: aggregateValue(null, null, false, "Sale item classification is not an authoritative revenue ledger"),
      productRevenuePaise: aggregateValue(null, null, false, "Sale item classification is not an authoritative revenue ledger")
    },
    support: metadata("/sales", { from: ranges.current.from, to: ranges.current.to }, "sales.total")
  };
}

function appointmentOperations(rows, branchIds, range) {
  const counts = new Map();
  const days = new Map();
  const hours = new Map();
  for (const row of rows) {
    const status = String(row.status || "unknown").toLowerCase();
    counts.set(status, (counts.get(status) || 0) + 1);
    days.set(row.businessDate, (days.get(row.businessDate) || 0) + 1);
    const hour = String(row.businessHour || "");
    if (/^\d{2}$/.test(hour)) hours.set(`${hour}:00`, (hours.get(`${hour}:00`) || 0) + 1);
  }
  const peak = (map, key) => {
    if (!map.size) return null;
    const [value, count] = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { [key]: value, appointments: count };
  };
  return {
    statusCounts: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => ({ status, count })),
    peakDay: peak(days, "date"),
    peakHour: peak(hours, "hour"),
    support: metadata("/appointments", { branchIds, from: range.from, to: range.to }, "appointments.startAt/status")
  };
}

function loadStaffStatus(tenantId, branchIds, today) {
  if (!hasColumns("staff", ["tenantId", "branchId", "id", "name", "role", "status"])) throw new Error("staff schema is incompatible");
  const staffScope = branchClause(branchIds, "branchId", "staffBranch");
  const staff = db.prepare(`SELECT id, name, role, branchId FROM staff
    WHERE tenantId = @tenantId AND ${staffScope.sql} AND lower(status) = 'active'
    ORDER BY name, id`).all({ tenantId, ...staffScope.params });

  let attendance = [];
  if (hasColumns("staff_attendance_logs", ["tenant_id", "branch_id", "staff_id", "business_date", "status", "clock_in_at", "clock_out_at"])) {
    const attendanceScope = branchClause(branchIds, "branch_id", "attendanceBranch");
    attendance = db.prepare(`SELECT staff_id AS staffId, branch_id AS branchId, status,
        clock_in_at AS clockIn, clock_out_at AS clockOut, 'staff_attendance_logs.clock_in_at/clock_out_at' AS statusSource FROM staff_attendance_logs
      WHERE tenant_id = @tenantId AND ${attendanceScope.sql} AND business_date = @today
      ORDER BY updated_at DESC, created_at DESC`).all({ tenantId, today, ...attendanceScope.params });
  } else if (hasColumns("staff_attendance", ["tenantId", "branchId", "staffId", "date", "status", "clockIn", "clockOut"])) {
    attendance = db.prepare(`SELECT staffId, branchId, status, clockIn, clockOut, 'staff_attendance.clockIn/clockOut' AS statusSource FROM staff_attendance
      WHERE tenantId = @tenantId AND ${staffScope.sql} AND date = @today`).all({ tenantId, today, ...staffScope.params });
  }
  const shifts = hasColumns("staff_shifts", ["tenantId", "branchId", "staffId", "date", "startTime", "endTime", "status"])
    ? db.prepare(`SELECT staffId, branchId, startTime, endTime, status FROM staff_shifts
        WHERE tenantId = @tenantId AND ${staffScope.sql} AND date = @today`).all({ tenantId, today, ...staffScope.params })
    : [];
  const appointmentScope = branchClause(branchIds, "branchId", "staffAppointmentBranch");
  const appointmentDate = businessDateSql("startAt");
  const appointments = hasColumns("appointments", ["tenantId", "branchId", "staffId", "startAt", "status"])
    ? db.prepare(`SELECT staffId, COUNT(*) AS count FROM appointments
        WHERE tenantId = @tenantId AND ${appointmentScope.sql} AND ${appointmentDate} = @today
          AND lower(status) NOT IN ('cancelled', 'canceled', 'no_show', 'no-show')
        GROUP BY staffId`).all({ tenantId, today, ...appointmentScope.params })
    : [];
  const attendanceByStaff = new Map();
  for (const row of attendance) if (!attendanceByStaff.has(row.staffId)) attendanceByStaff.set(row.staffId, row);
  const shiftsByStaff = new Map(shifts.map((row) => [row.staffId, row]));
  const appointmentsByStaff = new Map(appointments.map((row) => [row.staffId, Number(row.count || 0)]));
  return staff.map((person) => {
    const attendanceRow = attendanceByStaff.get(person.id);
    const shift = shiftsByStaff.get(person.id);
    const bookedAppointments = appointmentsByStaff.get(person.id) || 0;
    if (attendanceRow?.clockIn && !attendanceRow.clockOut) {
      return { ...person, operationalStatus: "clockedIn", statusSource: attendanceRow.statusSource, bookedAppointments };
    }
    if (shift && bookedAppointments) {
      return { ...person, operationalStatus: "scheduledWithAppointments", statusSource: "staff_shifts + appointments", bookedAppointments };
    }
    if (shift) return { ...person, operationalStatus: "scheduled", statusSource: "staff_shifts", bookedAppointments };
    return { ...person, operationalStatus: "statusUnavailable", statusSource: "No authoritative current attendance or schedule", bookedAppointments };
  });
}

function loadActionCentre(tenantId, branchIds, ranges, outstandingInvoices) {
  const categories = {};
  const items = [];
  const addCategory = (key, available, reason = null) => {
    categories[key] = { available, count: available ? 0 : null, reason, destination: null, trace: null };
  };
  const addItems = (key, rows, map, destination, trace) => {
    addCategory(key, true);
    categories[key].count = rows.length;
    categories[key].destination = destination;
    categories[key].trace = trace;
    const mapped = rows.slice(0, 20).map(map);
    items.push(...mapped);
  };

  if (hasColumns("staff_leaves", ["id", "tenant_id", "branch_id", "staff_id", "leave_type", "start_date", "end_date", "status"])) {
    const scope = branchClause(branchIds, "branch_id", "leaveBranch");
    const rows = db.prepare(`SELECT id, branch_id AS branchId, staff_id AS staffId, leave_type AS leaveType,
        start_date AS startDate, end_date AS endDate, status
      FROM staff_leaves WHERE tenant_id = @tenantId AND ${scope.sql} AND lower(status) = 'pending'
      ORDER BY start_date, id`).all({ tenantId, ...scope.params });
    addItems("pendingLeaves", rows, (row) => ({
      id: `leave:${row.id}`, type: "pendingLeave", label: `${row.leaveType || "Leave"} request awaiting decision`,
      severity: "attention", relevantDate: row.startDate, branchId: row.branchId, count: 1,
      sourceRecordId: row.id, sourceLabel: "staff_leaves.status",
       destination: ownerDestination("/owner/leave-requests", { search: row.id, status: "pending" }),
      trace: sourceTrace("/api/v1/staff/leaves", { id: row.id, status: "pending" }, "staff_leaves.status")
    }), ownerDestination("/owner/leave-requests", { status: "pending" }),
    sourceTrace("/api/v1/staff/leaves", { status: "pending" }, "staff_leaves.status"));
  } else addCategory("pendingLeaves", false, "staff_leaves source unavailable");

  if (hasColumns("staff_payroll_runs", ["id", "tenant_id", "branch_id", "period_start", "period_end", "status", "net_amount"])) {
    const scope = branchClause(branchIds, "branch_id", "payrollBranch");
    const rows = db.prepare(`SELECT id, branch_id AS branchId, period_start AS periodStart, period_end AS periodEnd,
        status, net_amount AS netAmount
      FROM staff_payroll_runs WHERE tenant_id = @tenantId AND ${scope.sql}
        AND lower(status) IN ('pending', 'submitted', 'awaiting_approval')
      ORDER BY period_end, id`).all({ tenantId, ...scope.params });
    addItems("payrollApprovals", rows, (row) => ({
      id: `payroll:${row.id}`, type: "payrollApproval", label: "Payroll run awaiting approval",
      severity: "attention", relevantDate: row.periodEnd, branchId: row.branchId, count: 1,
      valuePaise: paise(row.netAmount), sourceRecordId: row.id, sourceLabel: "staff_payroll_runs.status",
       destination: ownerDestination("/owner/payroll", { search: row.id, status: row.status }),
      trace: sourceTrace("/api/v1/staff/payroll/runs", { id: row.id }, "staff_payroll_runs.status")
    }), ownerDestination("/owner/payroll", { approvalState: "pending" }),
    sourceTrace("/api/v1/staff/payroll/runs", { approvalState: "pending" }, "staff_payroll_runs.status"));
  } else addCategory("payrollApprovals", false, "staff_payroll_runs source unavailable");

  if (hasColumns("products", ["id", "tenantId", "branchId", "name", "sku", "stock", "lowStockThreshold", "status", "updatedAt"])) {
    const scope = branchClause(branchIds, "branchId", "productBranch");
    const rows = db.prepare(`SELECT id, branchId, name, sku, stock, lowStockThreshold, updatedAt FROM products
      WHERE tenantId = @tenantId AND ${scope.sql} AND lower(status) = 'active' AND stock <= lowStockThreshold
      ORDER BY stock - lowStockThreshold, name`).all({ tenantId, ...scope.params });
    addItems("lowStock", rows, (row) => ({
      id: `stock:${row.id}`, type: "lowStock", label: `${row.name} is at or below reorder level`,
      severity: "attention", relevantDate: row.updatedAt || null, branchId: row.branchId, count: 1,
      value: Number(row.stock), threshold: Number(row.lowStockThreshold), sourceRecordId: row.id,
      sourceLabel: "products.stock/lowStockThreshold",
       destination: ownerDestination("/owner/inventory", { search: row.id, status: "reorder" }),
      trace: sourceTrace("/api/v1/products", { productId: row.id }, "products.stock/lowStockThreshold")
    }), ownerDestination("/owner/inventory", { status: "reorder" }),
    sourceTrace("/api/v1/products", { stockState: "low" }, "products.stock/lowStockThreshold"));
  } else addCategory("lowStock", false, "products source unavailable");

  if (outstandingInvoices === null) {
    addCategory("outstandingInvoices", false, "invoices source unavailable");
  } else {
    addItems("outstandingInvoices", outstandingInvoices, (row) => ({
      id: `invoice:${row.id}`, type: "outstandingInvoice", label: `Invoice ${row.invoiceNumber} has an outstanding balance`,
      severity: "attention", relevantDate: row.dueDate || null, branchId: row.branchId, count: 1,
      valuePaise: paise(row.balance), sourceRecordId: row.id, sourceLabel: "invoices.balance/status",
       destination: ownerDestination("/owner/revenue", { metric: "outstanding", search: row.id }),
      trace: sourceTrace("/api/v1/invoices", { id: row.id }, "invoices.balance/status")
    }), ownerDestination("/owner/revenue", { metric: "outstanding" }),
    sourceTrace("/api/v1/invoices", { paymentState: "outstanding" }, "invoices.balance/status"));
  }

  if (hasColumns("attendance_corrections", ["id", "tenant_id", "branch_id", "staff_id", "reason", "status", "created_at"])) {
    const scope = branchClause(branchIds, "branch_id", "attendanceBranch");
    const rows = db.prepare(`SELECT id, branch_id AS branchId, staff_id AS staffId, reason, status, created_at AS createdAt
      FROM attendance_corrections WHERE tenant_id = @tenantId AND ${scope.sql} AND lower(status) = 'pending'
      ORDER BY created_at, id`).all({ tenantId, ...scope.params });
    addItems("attendanceExceptions", rows, (row) => ({
      id: `attendance:${row.id}`, type: "attendanceCorrection", label: "Attendance correction awaiting decision",
      severity: "attention", relevantDate: row.createdAt, branchId: row.branchId, count: 1,
      sourceRecordId: row.id, sourceLabel: "attendance_corrections.status",
      destination: ownerDestination("/owner/attendance", { correctionId: row.id, status: "pending" }),
      trace: sourceTrace("/api/v1/staff/attendance/corrections", { id: row.id }, "attendance_corrections.status")
    }), ownerDestination("/owner/attendance", { correctionStatus: "pending" }),
    sourceTrace("/api/v1/staff/attendance/corrections", { status: "pending" }, "attendance_corrections.status"));
  } else addCategory("attendanceExceptions", false, "attendance_corrections source unavailable");

  if (hasColumns("appointments", ["id", "tenantId", "branchId", "clientId", "staffId", "status", "startAt"])) {
    const scope = branchClause(branchIds, "branchId", "actionAppointmentBranch");
    const dateSql = businessDateSql("startAt");
    const rows = db.prepare(`SELECT id, branchId, clientId, staffId, startAt, status FROM appointments
      WHERE tenantId = @tenantId AND ${scope.sql} AND ${dateSql} BETWEEN @from AND @to
        AND lower(status) IN ('pending', 'requested', 'conflict', 'needs_attention')
      ORDER BY startAt, id`).all({ tenantId, ...scope.params, from: ranges.current.from, to: ranges.current.to });
    addItems("appointmentExceptions", rows, (row) => ({
      id: `appointment:${row.id}`, type: "appointmentException", label: `Appointment requires handling: ${row.status}`,
      severity: "attention", relevantDate: row.startAt, branchId: row.branchId, count: 1,
      sourceRecordId: row.id, sourceLabel: "appointments.status",
      destination: ownerDestination("/owner/appointments", { appointmentId: row.id, status: row.status }),
      trace: sourceTrace("/api/v1/appointments", { appointmentId: row.id }, "appointments.status")
    }), ownerDestination("/owner/appointments", { exceptionState: "requiresHandling" }),
    sourceTrace("/api/v1/appointments", { exceptionState: "requiresHandling" }, "appointments.status"));
  } else addCategory("appointmentExceptions", false, "appointments source unavailable");

  addCategory("campaignExceptions", false, "Campaign records are not tenant-and-branch scoped");
  addCategory("branchWarnings", false, "No authoritative branch warning source is available");
  const totalAvailableActions = Object.values(categories)
    .filter((category) => category.available)
    .reduce((sum, category) => sum + Number(category.count || 0), 0);
  return { categories, totalAvailableActions, itemsReturned: items.length, items };
}

function comparisonValue(current, previous, unit, available, reason = null) {
  if (!available) {
    return {
      unit, current: null, previous: null, absoluteDelta: null, percentDelta: null,
      trend: "unavailable", comparisonAvailable: false,
      availability: { available: false, reason }, missingData: true
    };
  }
  const absoluteDelta = previous === null ? null : current - previous;
  return {
    unit,
    current,
    previous,
    absoluteDelta,
    percentDelta: previous === null || previous === 0 ? null : percent((absoluteDelta / previous) * 100),
    trend: previous === null ? "unavailable" : absoluteDelta > 0 ? "positive" : absoluteDelta < 0 ? "negative" : "flat",
    comparisonAvailable: previous !== null,
    availability: { available: true, reason: null },
    missingData: previous === null
  };
}

function unsupportedBranchMetric(unit, reason) {
  return comparisonValue(null, null, unit, false, reason);
}

function branchComparison(branches, currentSales, previousSales, currentAppointments, previousAppointments, availability) {
  const totalRevenuePaise = currentSales.reduce((sum, row) => sum + paise(row.total), 0);
  return branches.map((branch) => {
    const sales = currentSales.filter((row) => row.branchId === branch.id);
    const priorSales = previousSales.filter((row) => row.branchId === branch.id);
    const appointments = currentAppointments.filter((row) => row.branchId === branch.id);
    const priorAppointments = previousAppointments.filter((row) => row.branchId === branch.id);
    const currentSalesMetrics = salesMetrics(sales);
    const previousSalesMetrics = salesMetrics(priorSales);
    const currentCompleted = appointments.filter((row) => COMPLETED_APPOINTMENT_STATUSES.has(String(row.status || "").toLowerCase())).length;
    const previousCompleted = priorAppointments.filter((row) => COMPLETED_APPOINTMENT_STATUSES.has(String(row.status || "").toLowerCase())).length;
    const currentAverageBillPaise = currentSalesMetrics.bills ? Math.round(currentSalesMetrics.netRevenuePaise / currentSalesMetrics.bills) : 0;
    const previousAverageBillPaise = previousSalesMetrics.bills ? Math.round(previousSalesMetrics.netRevenuePaise / previousSalesMetrics.bills) : null;
    const netRevenue = comparisonValue(
      currentSalesMetrics.netRevenuePaise,
      previousSalesMetrics.netRevenuePaise,
      "paise",
      availability.sales,
      "Sales source unavailable"
    );
    const averageBill = comparisonValue(
      currentAverageBillPaise,
      previousAverageBillPaise,
      "paise",
      availability.sales,
      "Sales source unavailable"
    );
    return {
      branchId: branch.id,
      branchName: branch.name,
      metrics: {
        netRevenuePaise: netRevenue,
        grossSalesPaise: comparisonValue(currentSalesMetrics.grossSalesPaise, previousSalesMetrics.grossSalesPaise, "paise", availability.sales, "Sales source unavailable"),
        appointments: comparisonValue(appointments.length, priorAppointments.length, "count", availability.appointments, "Appointments source unavailable"),
        completedAppointments: comparisonValue(currentCompleted, previousCompleted, "count", availability.appointments, "Appointments source unavailable"),
        averageBillPaise: averageBill,
        refundsPaise: unsupportedBranchMetric("paise", "No authoritative scoped refund source is available"),
        serviceRevenuePaise: unsupportedBranchMetric("paise", "Sale item classification is not an authoritative revenue ledger"),
        productRevenuePaise: unsupportedBranchMetric("paise", "Sale item classification is not an authoritative revenue ledger")
      },
      contributionPercent: availability.sales && totalRevenuePaise
        ? percent((currentSalesMetrics.netRevenuePaise / totalRevenuePaise) * 100)
        : null,
      comparable: availability.sales && availability.appointments && averageBill.comparisonAvailable,
      missingData: !availability.sales || !availability.appointments || !averageBill.comparisonAvailable,
      rank: null
    };
  });
}

function summary(id, group, label, condition, currentValue, comparisonValue, metricKey, destination, trace, context, sourceLabel) {
  return { id, group, label, condition, currentValue, comparisonValue, metricKey, destination, trace, context, sourceLabel };
}

function deterministicSummaries(kpis, actions, appointmentSnapshot, branchIds, ranges) {
  const context = { branchIds, from: ranges.current.from, to: ranges.current.to };
  const actionLabels = {
    pendingLeaves: "leave requests",
    payrollApprovals: "payroll runs",
    lowStock: "products at reorder level",
    attendanceExceptions: "attendance corrections",
    appointmentExceptions: "appointments"
  };
  const rows = [];
  if (kpis.netRevenuePaise.comparisonAvailable && kpis.netRevenuePaise.absoluteDelta !== 0) {
    const group = kpis.netRevenuePaise.absoluteDelta > 0 ? "positive" : "attention";
    rows.push(summary(
      `net-revenue-${group}`, group,
      kpis.netRevenuePaise.absoluteDelta > 0 ? "Net revenue increased" : "Net revenue decreased",
      `current netRevenuePaise ${kpis.netRevenuePaise.absoluteDelta > 0 ? ">" : "<"} previous netRevenuePaise`,
      kpis.netRevenuePaise.current, kpis.netRevenuePaise.previous, "netRevenuePaise",
      ownerDestination("/owner/revenue", { branchIds, from: ranges.current.from, to: ranges.current.to }),
      kpis.netRevenuePaise.support, context, "sales.total"
    ));
  }
  if (kpis.completedAppointments.comparisonAvailable && kpis.completedAppointments.absoluteDelta !== 0) {
    const group = kpis.completedAppointments.absoluteDelta > 0 ? "positive" : "attention";
    rows.push(summary(
      `completed-appointments-${group}`, group,
      kpis.completedAppointments.absoluteDelta > 0 ? "Completed appointments increased" : "Completed appointments decreased",
      `current completedAppointments ${kpis.completedAppointments.absoluteDelta > 0 ? ">" : "<"} previous completedAppointments`,
      kpis.completedAppointments.current, kpis.completedAppointments.previous, "completedAppointments",
      ownerDestination("/owner/appointments", { branchIds, from: ranges.current.from, to: ranges.current.to, status: "completed" }),
      kpis.completedAppointments.support, context, "appointments.status"
    ));
  }
  if (kpis.outstandingPaise.availability.available && kpis.outstandingPaise.current > 0) {
    rows.push(summary(
      "outstanding-balance", "attention", "Outstanding balance is present",
      "current outstandingPaise > 0", kpis.outstandingPaise.current, kpis.outstandingPaise.previous,
      "outstandingPaise", ownerDestination("/owner/revenue", { branchIds, paymentState: "outstanding" }),
      kpis.outstandingPaise.support, context, "invoices.balance/status"
    ));
  }
  if (appointmentSnapshot.peakDay) {
    rows.push(summary(
      `appointment-peak-day-${appointmentSnapshot.peakDay.date}`, "operational",
      `${appointmentSnapshot.peakDay.date} has the highest appointment count in the selected range`,
      "appointment count equals the maximum daily count in the selected range",
      appointmentSnapshot.peakDay.appointments, null, "appointments.peakDay",
      ownerDestination("/owner/appointments", { branchIds, date: appointmentSnapshot.peakDay.date }),
      appointmentSnapshot.support, { ...context, peakDate: appointmentSnapshot.peakDay.date }, "appointments.startAt"
    ));
  }
  for (const [key, category] of Object.entries(actions.categories)) {
    if (key === "outstandingInvoices" || !category.available || !category.count) continue;
    rows.push(summary(
      `actions-${key}`, "operational", `${category.count} ${actionLabels[key] || key} require handling`,
      `${key} count > 0`, category.count, 0, `actionCentre.${key}`,
      category.destination, category.trace, context, category.trace?.sourceLabel || key
    ));
  }
  return {
    positive: rows.filter((row) => row.group === "positive"),
    attention: rows.filter((row) => row.group === "attention"),
    operational: rows.filter((row) => row.group === "operational")
  };
}

const ownerDashboardCache = new Map();
const OWNER_DASHBOARD_TTL_MS = 5000;

export class OwnerDashboardService {
  getDashboard(access, query = {}) {
    const cacheKey = `${access?.tenantId}|${access?.userId}|${query.branchId || "all"}|${query.range || "today"}|${query.from || ""}|${query.to || ""}`;
    const cached = ownerDashboardCache.get(cacheKey);
    const now = Date.now();
    if (cached && now < cached.expiresAt) return cached.data;

    const data = this.computeDashboard(access, query);
    ownerDashboardCache.set(cacheKey, { data, expiresAt: now + OWNER_DASHBOARD_TTL_MS });
    if (ownerDashboardCache.size > 200) {
      for (const [k, v] of ownerDashboardCache.entries()) {
        if (v.expiresAt < now) ownerDashboardCache.delete(k);
      }
    }
    return data;
  }

  computeDashboard(access, query = {}) {
    const tenantId = String(access.tenantId || "");
    const owner = db.prepare(`SELECT role, status, branchIds FROM tenant_users WHERE tenantId = @tenantId AND id = @userId`).get({ tenantId, userId: String(access.userId || "") });
    if (!owner || String(owner.role || "").toLowerCase() !== "owner" || String(owner.status || "").toLowerCase() !== "active") throw forbidden("Active owner access is required");
    let assignedBranchIds = [];
    try { const parsed = JSON.parse(owner.branchIds || "[]"); assignedBranchIds = Array.isArray(parsed) ? parsed : []; }
    catch { throw forbidden("Owner branch assignments are invalid"); }
    const accessibleBranchIds = [...new Set(assignedBranchIds.map((id) => String(id || "").trim()).filter(Boolean))];
    if (!tenantId || !accessibleBranchIds.length) throw forbidden("This owner session has no assigned branch access");

    const ranges = resolveRanges(query);
    const branches = loadBranches(tenantId, accessibleBranchIds);
    const availableIds = new Set(branches.map((branch) => branch.id));
    const inaccessibleAssignments = accessibleBranchIds.filter((id) => !availableIds.has(id));
    const requestedBranchId = String(query.branchId || access.requestedBranchId || "all").trim();
    if (requestedBranchId && requestedBranchId.toLowerCase() !== "all" && !availableIds.has(requestedBranchId)) {
      throw forbidden("The requested branch is not accessible to this owner session");
    }
    const selectedBranchIds = requestedBranchId && requestedBranchId.toLowerCase() !== "all"
      ? [requestedBranchId]
      : branches.map((branch) => branch.id);
    if (!selectedBranchIds.length) throw forbidden("No accessible branches are available for this owner session");

    const availability = {};
    const warnings = inaccessibleAssignments.length
      ? [{ source: "branches", code: "INACCESSIBLE_ASSIGNMENT_OMITTED", message: "Some session branch assignments no longer resolve to accessible branches" }]
      : [];
    const sales = safeSource("sales", availability, warnings, () => loadSales(tenantId, selectedBranchIds, ranges), []);
    const appointments = safeSource("appointments", availability, warnings, () => loadAppointments(tenantId, selectedBranchIds, ranges), []);
    const invoiceRows = safeSource("invoices", availability, warnings, () => loadInvoices(tenantId, selectedBranchIds, ranges), []);
    const outstandingInvoices = availability.invoices.available
      ? safeSource("outstandingInvoices", availability, warnings, () => loadInvoices(tenantId, selectedBranchIds, ranges, true), [])
      : null;
    const staffStatus = safeSource("staffOperations", availability, warnings, () => loadStaffStatus(tenantId, selectedBranchIds, istToday()), []);

    const currentSales = rangeRows(sales, ranges.current);
    const previousSales = rangeRows(sales, ranges.previous);
    const currentAppointments = rangeRows(appointments, ranges.current);
    const previousAppointments = rangeRows(appointments, ranges.previous);
    const clientIds = [...new Set(appointments.map((row) => row.clientId).filter(Boolean))];
    const firstVisits = availability.appointments.available
      ? safeSource("clientVisitHistory", availability, warnings, () => loadFirstCompletedVisits(tenantId, selectedBranchIds, clientIds), new Map())
      : new Map();
    const currentSaleMetrics = salesMetrics(currentSales);
    const previousSaleMetrics = salesMetrics(previousSales);
    const currentAppointmentMetrics = appointmentMetrics(currentAppointments, firstVisits, ranges.current);
    const previousAppointmentMetrics = appointmentMetrics(previousAppointments, firstVisits, ranges.previous);
    const currentOutstandingPaise = (outstandingInvoices || []).reduce((sum, row) => sum + paise(row.balance), 0);
    const previousOutstandingPaise = null;
    const outstandingAggregate = {
      available: availability.outstandingInvoices?.available === true,
      current: currentOutstandingPaise,
      previous: previousOutstandingPaise
    };
    const revenueSnapshot = availability.sales.available
      ? revenueSeries(currentSales, previousSales, ranges, currentSaleMetrics, previousSaleMetrics, outstandingAggregate)
      : {
          grouping: groupMode(ranges.current.spanDays),
          unit: "paise",
          current: [],
          previous: [],
          aggregates: {
            grossSalesPaise: aggregateValue(null, null, false, "Sales source unavailable"),
            netRevenuePaise: aggregateValue(null, null, false, "Sales source unavailable"),
            discountsPaise: aggregateValue(null, null, false, "Sales source unavailable"),
            taxesPaise: aggregateValue(null, null, false, "Sales source unavailable"),
            outstandingPaise: outstandingAggregate.available
              ? aggregateValue(outstandingAggregate.current, outstandingAggregate.previous)
              : aggregateValue(null, null, false, "Invoice source unavailable"),
            refundsPaise: aggregateValue(null, null, false, "No authoritative scoped refund source is available"),
            serviceRevenuePaise: aggregateValue(null, null, false, "Sale item classification is not an authoritative revenue ledger"),
            productRevenuePaise: aggregateValue(null, null, false, "Sale item classification is not an authoritative revenue ledger")
          },
          availability: { available: false, reason: "Sales source unavailable" }
        };
    const appointmentSnapshot = availability.appointments.available
      ? appointmentOperations(currentAppointments, selectedBranchIds, ranges.current)
      : { statusCounts: [], peakDay: null, peakHour: null, availability: { available: false, reason: "Appointments source unavailable" } };
    const branchFilter = selectedBranchIds.length === 1 ? { branchId: selectedBranchIds[0] } : { branchIds: selectedBranchIds };
    const salesSupport = metadata("/sales", { ...branchFilter, from: ranges.current.from, to: ranges.current.to }, "sales");
    const appointmentSupport = metadata("/appointments", { ...branchFilter, from: ranges.current.from, to: ranges.current.to }, "appointments");
    const invoiceSupport = metadata("/invoices", { ...branchFilter, paymentState: "outstanding" }, "invoices");

    const unavailableSales = (unit, key) => unavailableKpi(unit, metadata("/sales", branchFilter, key), "Sales source unavailable");
    const unavailableAppointments = (key) => unavailableKpi("count", metadata("/appointments", branchFilter, key), "Appointments source unavailable");
    const kpis = {
      netRevenuePaise: availability.sales.available
        ? kpi(currentSaleMetrics.netRevenuePaise, previousSaleMetrics.netRevenuePaise, "paise", salesSupport,
            revenueSnapshot.current.map((row) => ({ bucket: row.bucket, valuePaise: row.netRevenuePaise })))
        : unavailableSales("paise", "sales.total"),
      grossSalesPaise: availability.sales.available
        ? kpi(currentSaleMetrics.grossSalesPaise, previousSaleMetrics.grossSalesPaise, "paise", salesSupport)
        : unavailableSales("paise", "sales.subtotal"),
      appointments: availability.appointments.available
        ? kpi(currentAppointmentMetrics.appointments, previousAppointmentMetrics.appointments, "count", appointmentSupport)
        : unavailableAppointments("appointments.count"),
      completedAppointments: availability.appointments.available
        ? kpi(currentAppointmentMetrics.completedAppointments, previousAppointmentMetrics.completedAppointments, "count", appointmentSupport)
        : unavailableAppointments("appointments.status"),
      newClients: availability.clientVisitHistory?.available
        ? kpi(currentAppointmentMetrics.newClients, previousAppointmentMetrics.newClients, "count", appointmentSupport)
        : unavailableAppointments("appointments.firstCompletedVisit"),
      returningClients: availability.clientVisitHistory?.available
        ? kpi(currentAppointmentMetrics.returningClients, previousAppointmentMetrics.returningClients, "count", appointmentSupport)
        : unavailableAppointments("appointments.priorCompletedVisit"),
      averageBillPaise: availability.sales.available
        ? kpi(
            currentSaleMetrics.bills ? Math.round(currentSaleMetrics.netRevenuePaise / currentSaleMetrics.bills) : 0,
            previousSaleMetrics.bills ? Math.round(previousSaleMetrics.netRevenuePaise / previousSaleMetrics.bills) : null,
            "paise", salesSupport)
        : unavailableSales("paise", "sales.total/count"),
      outstandingPaise: availability.outstandingInvoices?.available === true
        ? kpi(currentOutstandingPaise, previousOutstandingPaise, "paise", invoiceSupport)
        : unavailableKpi("paise", invoiceSupport, "Invoice source unavailable")
    };

    const actions = safeSource(
      "actionCentre", availability, warnings,
      () => loadActionCentre(
        tenantId,
        selectedBranchIds,
        ranges,
        availability.outstandingInvoices?.available === true ? outstandingInvoices : null
      ),
      { categories: {}, totalAvailableActions: null, itemsReturned: 0, items: [] }
    );
    const comparison = branchComparison(
      branches.filter((branch) => selectedBranchIds.includes(branch.id)),
      currentSales,
      previousSales,
      currentAppointments,
      previousAppointments,
      { sales: availability.sales.available, appointments: availability.appointments.available }
    );

    return {
      schemaVersion: "2.0",
      context: {
        selection: selectedBranchIds.length === 1
          ? { type: "branch", branchId: selectedBranchIds[0], label: branches.find((branch) => branch.id === selectedBranchIds[0])?.name || selectedBranchIds[0] }
          : { type: "allAccessibleBranches", branchId: null, label: "All accessible branches" },
        accessibleBranches: branches.map((branch) => ({
          id: branch.id, name: branch.name, city: branch.city || "", timezone: branch.timezone || "Asia/Kolkata", status: branch.status
        })),
        selectedBranchIds,
        currentRange: ranges.current,
        previousRange: ranges.previous,
        customRangeLimitDays: MAX_CUSTOM_DAYS,
        generatedAt: new Date().toISOString()
      },
      kpis,
      revenue: revenueSnapshot,
      appointments: appointmentSnapshot,
      staffOperations: {
        asOfBusinessDate: istToday(),
        realtimePresenceClaimed: false,
        availability: availability.staffOperations,
        staff: staffStatus
      },
      actionCentre: actions,
      branchComparison: {
        contributionMetric: "netRevenuePaise",
        rankingApplied: false,
        branches: comparison
      },
      summaries: deterministicSummaries(kpis, actions, appointmentSnapshot, selectedBranchIds, ranges),
      sources: {
        availability,
        partial: warnings.length > 0,
        warnings
      }
    };
  }
}

export const ownerDashboardService = new OwnerDashboardService();
