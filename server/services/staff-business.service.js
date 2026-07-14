import { columnsFor, db } from "../db.js";
import { can } from "../middleware/rbac.js";
import { badRequest } from "../utils/app-error.js";
import { staffLoginService } from "./staff-login.service.js";
import { staffBusinessPerformanceService } from "./staff-business-performance.service.js";

const completedStatuses = new Set(["completed", "checked-out", "checked_out", "checkout", "done"]);
const activeStatuses = new Set(["in-service", "in service", "inprogress", "in progress", "started", "active", "running"]);
const terminalStatuses = new Set([...completedStatuses, "cancelled", "canceled", "no-show", "voided"]);
const istFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function istDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function businessDate(value) {
  const date = String(value || istDate()).trim();
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw badRequest("date must use YYYY-MM-DD format");
  }
  return date;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function businessRange(query = {}) {
  const legacyDate = String(query.date || "").trim();
  const from = businessDate(query.from || legacyDate || istDate());
  const to = businessDate(query.to || legacyDate || from);
  if (from > to) throw badRequest("from date must be on or before to date");
  return {
    from,
    to,
    fromUtc: new Date(`${from}T00:00:00.000+05:30`).toISOString(),
    toUtc: new Date(`${addDays(to, 1)}T00:00:00.000+05:30`).toISOString()
  };
}

function istDateFor(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(istFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function statusGroup(value) {
  const status = String(value || "").trim().toLowerCase();
  if (completedStatuses.has(status)) return "completed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (activeStatuses.has(status)) return "in-service";
  return status;
}

function moneyPaise(row, keys) {
  for (const key of keys) {
    if (row?.[key] === undefined || row?.[key] === null || row?.[key] === "") continue;
    const value = Number(row[key]);
    if (!Number.isFinite(value)) continue;
    return Math.round(value * (/paise/i.test(key) ? 1 : 100));
  }
  return 0;
}

function rowsByIds(table, column, ids, access, branchId) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];
  if (uniqueIds.length > 400) {
    return Array.from({ length: Math.ceil(uniqueIds.length / 400) }, (_, index) =>
      rowsByIds(table, column, uniqueIds.slice(index * 400, index * 400 + 400), access, branchId)
    ).flat();
  }
  const columns = columnsFor(table);
  const params = Object.fromEntries(uniqueIds.map((id, index) => [`id${index}`, id]));
  const filters = [`${column} IN (${uniqueIds.map((_, index) => `@id${index}`).join(", ")})`];
  const tenantColumn = columns.includes("tenantId") ? "tenantId" : columns.includes("tenant_id") ? "tenant_id" : "";
  const branchColumn = columns.includes("branchId") ? "branchId" : columns.includes("branch_id") ? "branch_id" : "";
  if (tenantColumn) {
    filters.push(`${tenantColumn} = @tenantId`);
    params.tenantId = access.tenantId;
  }
  if (branchColumn && branchId) {
    filters.push(`${branchColumn} = @branchId`);
    params.branchId = branchId;
  }
  const order = columns.includes("createdAt") ? " ORDER BY createdAt DESC" : "";
  return db.prepare(`SELECT * FROM ${table} WHERE ${filters.join(" AND ")}${order}`).all(params);
}

function billingDetails(sale, invoice) {
  const subtotalPaise = moneyPaise(sale, ["subtotalPaise", "subtotal_paise", "subtotal"])
    || moneyPaise(invoice, ["subtotalPaise", "subtotal_paise", "subtotal"]);
  const totalDiscountPaise = moneyPaise(sale, ["discountPaise", "discount_paise", "discount"])
    || moneyPaise(invoice, ["discountTotalPaise", "discount_total_paise", "discountPaise", "discount_paise", "discount_total", "discount"]);
  const couponDiscountPaise = moneyPaise(sale, ["couponDiscountPaise", "coupon_discount_paise", "couponDiscount", "coupon_discount"]);
  const discountPaise = Math.max(0, totalDiscountPaise - couponDiscountPaise);
  const gstPaise = moneyPaise(invoice, ["taxTotalPaise", "tax_total_paise", "gstAmountPaise", "gst_amount_paise", "tax_total", "gstAmount", "gst_amount"])
    || moneyPaise(sale, ["gstAmountPaise", "gst_amount_paise", "gstAmount", "gst_amount"]);
  const totalPaise = moneyPaise(invoice, ["grandTotalPaise", "grand_total_paise", "totalPaise", "total_paise", "grand_total", "total"])
    || moneyPaise(sale, ["totalPaise", "total_paise", "total"]);
  const paidPaise = moneyPaise(invoice, ["paidAmountPaise", "paid_amount_paise", "paidPaise", "paid_paise", "paid_amount", "paid"]);
  const duePaise = moneyPaise(invoice, ["dueAmountPaise", "due_amount_paise", "balancePaise", "balance_paise", "due_amount", "balance"]);
  return {
    saleId: sale.id,
    invoiceId: invoice?.id || "",
    invoiceNumber: invoice?.invoiceNumber || invoice?.invoice_no || "",
    invoiceStatus: invoice?.payment_status || invoice?.status || sale.status || "",
    subtotalPaise,
    discountPaise,
    couponDiscountPaise,
    afterDiscountPaise: Math.max(0, subtotalPaise - totalDiscountPaise),
    gstPaise,
    totalPaise,
    paidPaise,
    duePaise
  };
}

function durationMinutes(row) {
  const start = new Date(row.startAt || "").getTime();
  const end = new Date(row.endAt || "").getTime();
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return Math.round((end - start) / 60000);
  return Math.max(0, Number(row.durationMinutes || 0));
}

function timerDetails(row, date, today) {
  const duration = durationMinutes(row);
  const status = String(row.status || "booked").toLowerCase();
  const live = date === today && activeStatuses.has(status);
  const start = new Date(row.startAt || "").getTime();
  const elapsed = live && Number.isFinite(start) ? Math.max(0, Math.round((Date.now() - start) / 60000)) : completedStatuses.has(status) ? duration : 0;
  return {
    appointmentId: row.id,
    clientName: row.clientName,
    status,
    live,
    elapsedMinutes: Math.min(duration, elapsed),
    totalMinutes: duration,
    remainingMinutes: Math.max(0, duration - elapsed),
    progress: duration ? Math.min(100, Math.round((elapsed / duration) * 100)) : 0
  };
}

function summaryFor(rows) {
  const summary = {
    appointments: rows.length,
    completedServices: 0,
    scheduledMinutes: 0,
    completedMinutes: 0,
    workedMinutes: 0,
    bills: 0,
    subtotalPaise: 0,
    discountPaise: 0,
    couponDiscountPaise: 0,
    afterDiscountPaise: 0,
    gstPaise: 0,
    totalPaise: 0,
    paidPaise: 0,
    duePaise: 0
  };
  for (const row of rows) {
    const completed = completedStatuses.has(String(row.status || "").toLowerCase());
    summary.scheduledMinutes += row.durationMinutes;
    summary.workedMinutes += row.workedMinutes;
    if (completed) {
      summary.completedMinutes += row.durationMinutes;
      summary.completedServices += Math.max(1, row.serviceNames?.length || 0);
    }
    if (!row.billing) continue;
    summary.bills += 1;
    for (const key of ["subtotalPaise", "discountPaise", "couponDiscountPaise", "afterDiscountPaise", "gstPaise", "totalPaise", "paidPaise", "duePaise"]) {
      summary[key] += Number(row.billing[key] || 0);
    }
  }
  return summary;
}

function buildBusinessData(query, access) {
  const range = businessRange(query);
  const staffId = staffLoginService.resolveStaffId(query, access);
  const staff = staffLoginService.getStaff(staffId, access);
  const identityIds = staffLoginService.staffIdentityIds(staff, access.tenantId);
  const branchId = staff.branchId || access.branchId || "";
  const params = {
    tenantId: access.tenantId,
    branchId,
    fromUtc: range.fromUtc,
    toUtc: range.toUtc,
    ...Object.fromEntries(identityIds.map((id, index) => [`staffId${index}`, id]))
  };
  const filters = [
    "tenantId = @tenantId",
    `staffId IN (${identityIds.map((_, index) => `@staffId${index}`).join(", ")})`,
    "startAt >= @fromUtc",
    "startAt < @toUtc"
  ];
  if (branchId) filters.push("branchId = @branchId");

  // ponytail: aggregate the staff-scoped range in memory; move aggregation to SQL only if multi-year profiles become a measured bottleneck.
  const rawAppointments = db.prepare(`SELECT * FROM appointments WHERE ${filters.join(" AND ")} ORDER BY startAt ASC`).all(params);
  const appointments = staffLoginService.enrichAppointments(rawAppointments, access.tenantId);
  const billingVisible = ["finance", "sales", "payments", "invoices"].some((resource) =>
    can(access.role || "staff", "read", resource, access)
  );
  const sales = billingVisible ? rowsByIds("sales", "appointmentId", appointments.map((row) => row.id), access, branchId) : [];
  const saleByAppointment = new Map();
  for (const sale of sales) {
    if (["deleted", "voided"].includes(String(sale.status || "").toLowerCase())) continue;
    if (!saleByAppointment.has(sale.appointmentId)) saleByAppointment.set(sale.appointmentId, sale);
  }
  const invoices = billingVisible ? rowsByIds("invoices", "saleId", [...saleByAppointment.values()].map((sale) => sale.id), access, branchId) : [];
  const invoiceBySale = new Map();
  for (const invoice of invoices) {
    if (["deleted", "voided"].includes(String(invoice.status || "").toLowerCase())) continue;
    if (!invoiceBySale.has(invoice.saleId)) invoiceBySale.set(invoice.saleId, invoice);
  }

  const today = istDate();
  let rows = appointments.map((appointment) => {
    const businessDate = istDateFor(appointment.startAt);
    const timer = timerDetails(appointment, businessDate, today);
    const status = String(appointment.status || "booked").toLowerCase();
    const duration = timer.totalMinutes;
    const sale = saleByAppointment.get(appointment.id);
    const billing = billingVisible && sale ? billingDetails(sale, invoiceBySale.get(sale.id)) : null;
    const start = new Date(appointment.startAt || "").getTime();
    return {
      ...appointment,
      businessDate,
      state: timer.live ? "active" : !terminalStatuses.has(status) && Number.isFinite(start) && start < Date.now() ? "late" : "planned",
      durationMinutes: duration,
      workedMinutes: completedStatuses.has(status) ? duration : timer.live ? timer.elapsedMinutes : 0,
      timer,
      billing
    };
  });

  const status = String(query.status || "").trim().toLowerCase();
  const search = String(query.q || "").trim().toLowerCase();
  if (status && status !== "all") rows = rows.filter((row) => statusGroup(row.status) === statusGroup(status));
  if (search) {
    rows = rows.filter((row) => [
      row.clientName,
      ...(row.serviceNames || []),
      row.billing?.invoiceNumber,
      row.billing?.saleId
    ].join(" ").toLowerCase().includes(search));
  }

  const sort = String(query.sort || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  rows.sort((left, right) => {
    const dateOrder = left.businessDate.localeCompare(right.businessDate);
    if (dateOrder) return sort === "asc" ? dateOrder : -dateOrder;
    return String(left.startAt || "").localeCompare(String(right.startAt || "")) || String(left.id).localeCompare(String(right.id));
  });

  const daily = new Map();
  for (const row of rows) {
    if (!daily.has(row.businessDate)) daily.set(row.businessDate, []);
    daily.get(row.businessDate).push(row);
  }
  const dailyBreakdown = [...daily.entries()]
    .sort(([left], [right]) => sort === "asc" ? left.localeCompare(right) : right.localeCompare(left))
    .map(([date, dayRows]) => ({ date, ...summaryFor(dayRows) }));

  return {
    date: String(query.date || range.to),
    range: { from: range.from, to: range.to, timeZone: "Asia/Kolkata" },
    staff,
    billingVisible,
    summary: summaryFor(rows),
    dailyBreakdown,
    rows
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function moneyInr(paise) {
  return (Number(paise || 0) / 100).toFixed(2);
}

export const staffBusinessService = {
  daily(query = {}, access = {}) {
    return staffBusinessPerformanceService.daily(query, access);
  },

  csv(query = {}, access = {}) {
    return staffBusinessPerformanceService.csv(query, access);
  },

  streamCsv(query = {}, access = {}, write) {
    return staffBusinessPerformanceService.streamCsv(query, access, write);
  },

  csvFilename(query = {}, access = {}) {
    return staffBusinessPerformanceService.csvFilename(query, access);
  },

  invoiceDetail(invoiceId, access = {}) {
    return staffBusinessPerformanceService.invoiceDetail(invoiceId, access);
  }
};
