import { columnsFor, db } from "../db.js";
import { can } from "../middleware/rbac.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { staffLoginService } from "./staff-login.service.js";
import { attributedSalesItems } from "./staff-sales-report.service.js";

const completedStatuses = new Set(["completed", "checked-out", "checked_out", "checkout", "done"]);
const activeStatuses = new Set(["in-service", "in service", "inprogress", "in progress", "started", "active", "running"]);
const terminalStatuses = new Set([...completedStatuses, "cancelled", "canceled", "no-show", "voided"]);
const moneyKeys = ["subtotalPaise", "discountPaise", "couponDiscountPaise", "afterDiscountPaise", "gstPaise", "totalPaise", "paidPaise", "duePaise"];
const attributionKeys = [
  "attributedGrossPaise", "attributedDiscountPaise", "attributedCouponDiscountPaise",
  "attributedAfterDiscountPaise", "attributedGstPaise", "attributedPaidPaise", "attributedDuePaise",
  "serviceRevenuePaise", "productRevenuePaise", "membershipRevenuePaise", "packageRevenuePaise", "giftCardRevenuePaise"
];
const istFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function istDate(value = new Date()) {
  const parts = Object.fromEntries(istFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validDate(value) {
  const date = String(value || "").trim();
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
  const legacy = String(query.date || "").trim();
  const from = validDate(query.from || legacy || istDate());
  const to = validDate(query.to || legacy || from);
  if (from > to) throw badRequest("from date must be on or before to date");
  return {
    from,
    to,
    fromUtc: new Date(`${from}T00:00:00.000+05:30`).toISOString(),
    toUtc: new Date(`${addDays(to, 1)}T00:00:00.000+05:30`).toISOString()
  };
}

function dateFor(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? "" : istDate(parsed);
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @name").get({ name }));
}

function readArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function statusGroup(value) {
  const status = String(value || "").trim().toLowerCase();
  if (completedStatuses.has(status)) return "completed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["no-show", "no show", "noshow"].includes(status)) return "no-show";
  if (activeStatuses.has(status)) return "in-service";
  return status;
}

function statusBucket(value) {
  const status = statusGroup(value);
  if (["booked", "scheduled", "pending", "queued"].includes(status)) return "booked";
  if (status === "confirmed") return "confirmed";
  if (["arrived", "checked-in", "checked_in"].includes(status)) return "arrived";
  if (status === "in-service") return "inService";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "no-show") return "noShow";
  return "other";
}

function moneyPaise(row, keys) {
  for (const key of keys) {
    if (row?.[key] === undefined || row?.[key] === null || row?.[key] === "") continue;
    const value = Number(row[key]);
    if (Number.isFinite(value)) return Math.round(value * (/paise/i.test(key) ? 1 : 100));
  }
  return 0;
}

function rupeesToPaise(value) {
  return Math.round((Number(value) || 0) * 100);
}

function rowsByIds(table, column, ids, access, branchId) {
  if (!tableExists(table)) return [];
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return [];
  if (unique.length > 400) {
    return Array.from({ length: Math.ceil(unique.length / 400) }, (_, index) =>
      rowsByIds(table, column, unique.slice(index * 400, index * 400 + 400), access, branchId)
    ).flat();
  }
  const columns = columnsFor(table);
  const params = Object.fromEntries(unique.map((id, index) => [`id${index}`, id]));
  const filters = [`${column} IN (${unique.map((_, index) => `@id${index}`).join(", ")})`];
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
  const orderColumn = columns.includes("createdAt") ? "createdAt" : columns.includes("created_at") ? "created_at" : "";
  return db.prepare(`SELECT * FROM ${table} WHERE ${filters.join(" AND ")}${orderColumn ? ` ORDER BY ${orderColumn} DESC` : ""}`).all(params);
}

function billingDetails(sale = {}, invoice = {}) {
  const subtotalPaise = moneyPaise(sale, ["subtotalPaise", "subtotal_paise", "subtotal"])
    || moneyPaise(invoice, ["subtotalPaise", "subtotal_paise", "subtotal"]);
  const totalDiscountPaise = moneyPaise(sale, ["discountPaise", "discount_paise", "discount"])
    || moneyPaise(invoice, ["discountTotalPaise", "discount_total_paise", "discountPaise", "discount_paise", "discount_total", "discount"]);
  const couponDiscountPaise = moneyPaise(sale, ["couponDiscountPaise", "coupon_discount_paise", "couponDiscount", "coupon_discount"])
    || moneyPaise(invoice, ["couponDiscountPaise", "coupon_discount_paise", "couponDiscount", "coupon_discount"]);
  const gstPaise = moneyPaise(invoice, ["taxTotalPaise", "tax_total_paise", "gstAmountPaise", "gst_amount_paise", "tax_total", "gstAmount", "gst_amount"])
    || moneyPaise(sale, ["gstAmountPaise", "gst_amount_paise", "gstAmount", "gst_amount"]);
  const totalPaise = moneyPaise(invoice, ["grandTotalPaise", "grand_total_paise", "totalPaise", "total_paise", "grand_total", "total"])
    || moneyPaise(sale, ["totalPaise", "total_paise", "total"]);
  const paidPaise = moneyPaise(invoice, ["paidAmountPaise", "paid_amount_paise", "paidPaise", "paid_paise", "paid_amount", "paid"]);
  const duePaise = moneyPaise(invoice, ["dueAmountPaise", "due_amount_paise", "balancePaise", "balance_paise", "due_amount", "balance"]);
  return {
    saleId: sale.id || "",
    invoiceId: invoice.id || "",
    invoiceNumber: invoice.invoiceNumber || invoice.invoice_no || "",
    invoiceStatus: invoice.payment_status || invoice.status || sale.status || "",
    subtotalPaise,
    discountPaise: Math.max(0, totalDiscountPaise - couponDiscountPaise),
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

function activityTimer(row, events, today) {
  const scheduled = durationMinutes(row);
  const status = String(row.status || "booked").toLowerCase();
  let openStartedAt = "";
  let latestPair = null;
  for (const event of [...events].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))) {
    const action = String(event.action || "").toUpperCase();
    if (action === "STARTED") openStartedAt = event.createdAt || "";
    if (action === "COMPLETED" && openStartedAt) {
      const start = new Date(openStartedAt).getTime();
      const end = new Date(event.createdAt || "").getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) latestPair = { startedAt: openStartedAt, completedAt: event.createdAt };
      openStartedAt = "";
    }
  }

  const live = dateFor(row.startAt) === today && activeStatuses.has(status);
  const pair = completedStatuses.has(status) ? latestPair : null;
  const actualStart = pair?.startedAt || (live && openStartedAt ? openStartedAt : "");
  const actualEnd = pair?.completedAt || "";
  let elapsed = 0;
  let timeSource = "estimated";
  if (actualStart && (actualEnd || live)) {
    const start = new Date(actualStart).getTime();
    const end = actualEnd ? new Date(actualEnd).getTime() : Date.now();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      elapsed = Math.round((end - start) / 60000);
      timeSource = "actual";
    }
  } else if (completedStatuses.has(status)) {
    elapsed = scheduled;
  }
  return {
    appointmentId: row.id,
    clientName: row.clientName,
    status,
    live,
    startedAt: actualStart || null,
    completedAt: actualEnd || null,
    timeSource,
    elapsedMinutes: elapsed,
    totalMinutes: scheduled,
    remainingMinutes: Math.max(0, scheduled - elapsed),
    overrunMinutes: Math.max(0, elapsed - scheduled),
    progress: scheduled ? Math.min(100, Math.round((elapsed / scheduled) * 100)) : 0
  };
}

function allocatePaise(totalPaise, rows, identities) {
  if (!totalPaise || !rows.length) return 0;
  const weights = new Map();
  for (const row of rows) {
    const key = String(row.staffId || "unassigned");
    weights.set(key, (weights.get(key) || 0) + Math.max(0, Number(row.amount || row.netSale || 0)));
  }
  const entries = [...weights.entries()].sort(([left], [right]) => left.localeCompare(right));
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return 0;
  let allocated = 0;
  let self = 0;
  entries.forEach(([staffId, weight], index) => {
    const amount = index === entries.length - 1 ? totalPaise - allocated : Math.floor((totalPaise * weight) / totalWeight);
    allocated += amount;
    if (identities.has(staffId)) self += amount;
  });
  return self;
}

function attributionDetails(sale, invoice, itemRows, identities, appointment) {
  const bill = billingDetails(sale, invoice);
  let allocationRows = itemRows;
  if (!allocationRows.length) {
    allocationRows = [{
      staffId: String(sale.staffId || appointment.staffId || "unassigned"),
      amount: Math.max(1, bill.afterDiscountPaise) / 100,
      itemType: "service"
    }];
  }
  const selfRows = allocationRows.filter((row) => identities.has(String(row.staffId)));
  const category = (type) => Math.round(selfRows
    .filter((row) => row.itemType === type)
    .reduce((sum, row) => sum + Number(row.netSale ?? row.amount ?? 0), 0) * 100);
  return {
    saleId: bill.saleId,
    invoiceId: bill.invoiceId,
    grossPaise: allocatePaise(bill.subtotalPaise, allocationRows, identities),
    discountPaise: allocatePaise(bill.discountPaise, allocationRows, identities),
    couponDiscountPaise: allocatePaise(bill.couponDiscountPaise, allocationRows, identities),
    afterDiscountPaise: allocatePaise(bill.afterDiscountPaise, allocationRows, identities),
    gstPaise: allocatePaise(bill.gstPaise, allocationRows, identities),
    totalPaise: allocatePaise(bill.totalPaise, allocationRows, identities),
    paidPaise: allocatePaise(bill.paidPaise, allocationRows, identities),
    duePaise: allocatePaise(bill.duePaise, allocationRows, identities),
    serviceRevenuePaise: category("service"),
    productRevenuePaise: category("product"),
    membershipRevenuePaise: category("membership"),
    packageRevenuePaise: category("package"),
    giftCardRevenuePaise: category("gift_card")
  };
}

function blankSummary() {
  return {
    appointments: 0,
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
}

function blankPerformance() {
  return {
    statusCounts: { booked: 0, confirmed: 0, arrived: 0, inService: 0, completed: 0, cancelled: 0, noShow: 0, other: 0 },
    uniqueClients: 0,
    invoiceCount: 0,
    actualWorkedMinutes: 0,
    estimatedWorkedMinutes: 0,
    attendanceMinutes: 0,
    breakMinutes: 0,
    dutyMinutes: 0,
    utilizationPercent: null,
    attributedGrossPaise: 0,
    attributedDiscountPaise: 0,
    attributedCouponDiscountPaise: 0,
    attributedAfterDiscountPaise: 0,
    attributedGstPaise: 0,
    attributedPaidPaise: 0,
    attributedDuePaise: 0,
    averageBillPaise: 0,
    revenuePerWorkedHourPaise: 0,
    serviceRevenuePaise: 0,
    productRevenuePaise: 0,
    membershipRevenuePaise: 0,
    packageRevenuePaise: 0,
    giftCardRevenuePaise: 0,
    _clients: new Set(),
    _invoices: new Set(),
    _attributions: new Set()
  };
}

function addRow(summary, performance, row, invoiceSeen) {
  summary.appointments += 1;
  summary.scheduledMinutes += row.durationMinutes;
  summary.workedMinutes += row.workedMinutes;
  if (completedStatuses.has(String(row.status || "").toLowerCase())) {
    summary.completedMinutes += row.workedMinutes;
    summary.completedServices += Math.max(1, row.serviceNames?.length || 0);
  }
  performance.statusCounts[statusBucket(row.status)] += 1;
  if (row.clientId || row.clientName) performance._clients.add(String(row.clientId || row.clientName).toLowerCase());
  if (row.workedMinutes) {
    if (row.timer.timeSource === "actual") performance.actualWorkedMinutes += row.workedMinutes;
    else performance.estimatedWorkedMinutes += row.workedMinutes;
  }
  const invoiceKey = row.billing?.invoiceId || row.billing?.saleId;
  if (row.billing && invoiceKey && !invoiceSeen.has(invoiceKey)) {
    invoiceSeen.add(invoiceKey);
    summary.bills += 1;
    for (const key of moneyKeys) summary[key] += Number(row.billing[key] || 0);
  }
  const attributionKey = row.attribution?.invoiceId || row.attribution?.saleId;
  if (row.attribution && attributionKey && !performance._attributions.has(attributionKey)) {
    performance._attributions.add(attributionKey);
    performance._invoices.add(attributionKey);
    performance.attributedGrossPaise += row.attribution.grossPaise;
    performance.attributedDiscountPaise += row.attribution.discountPaise;
    performance.attributedCouponDiscountPaise += row.attribution.couponDiscountPaise;
    performance.attributedAfterDiscountPaise += row.attribution.afterDiscountPaise;
    performance.attributedGstPaise += row.attribution.gstPaise;
    performance.attributedPaidPaise += row.attribution.paidPaise;
    performance.attributedDuePaise += row.attribution.duePaise;
    for (const key of ["serviceRevenuePaise", "productRevenuePaise", "membershipRevenuePaise", "packageRevenuePaise", "giftCardRevenuePaise"]) {
      performance[key] += Number(row.attribution[key] || 0);
    }
  }
}

function finishPerformance(performance, billingVisible) {
  performance.uniqueClients = performance._clients.size;
  performance.invoiceCount = performance._invoices.size;
  const worked = performance.actualWorkedMinutes + performance.estimatedWorkedMinutes;
  performance.utilizationPercent = performance.dutyMinutes > 0 ? Math.round((worked / performance.dutyMinutes) * 1000) / 10 : null;
  performance.averageBillPaise = performance.invoiceCount ? Math.round(performance.attributedAfterDiscountPaise / performance.invoiceCount) : 0;
  performance.revenuePerWorkedHourPaise = worked ? Math.round((performance.attributedAfterDiscountPaise * 60) / worked) : 0;
  delete performance._clients;
  delete performance._invoices;
  delete performance._attributions;
  if (!billingVisible) {
    for (const key of [...attributionKeys, "averageBillPaise", "revenuePerWorkedHourPaise"]) performance[key] = null;
    performance.invoiceCount = 0;
  }
  return performance;
}

function hideSummaryMoney(summary, billingVisible) {
  if (!billingVisible) {
    summary.bills = 0;
    for (const key of moneyKeys) summary[key] = null;
  }
  return summary;
}

function permissionsFor(access) {
  const readable = (resource) => can(access.role || "staff", "read", resource, access);
  return {
    billing: ["finance", "sales", "payments", "invoices"].some(readable),
    earnings: ["payroll", "finance"].some(readable),
    targets: readable("staff"),
    invoiceDetail: readable("invoices")
  };
}

function appointmentContext(query, access) {
  const range = businessRange(query);
  const staffId = staffLoginService.resolveStaffId(query, access);
  const staff = staffLoginService.getStaff(staffId, access);
  const identityIds = staffLoginService.staffIdentityIds(staff, access.tenantId).map(String);
  const branchId = staff.branchId || access.branchId || "";
  return {
    query,
    access,
    range,
    staff,
    identityIds,
    identities: new Set(identityIds),
    branchId,
    permissions: permissionsFor(access),
    sort: String(query.sort || "desc").toLowerCase() === "asc" ? "asc" : "desc"
  };
}

function branchServicesFor(context) {
  if (!context.branchId || !tableExists("services")) return [];
  const columns = columnsFor("services");
  if (!columns.includes("tenantId") || !columns.includes("branchId")) return [];
  const activeFilter = columns.includes("status") ? " AND status = 'active'" : "";
  return db.prepare(`SELECT id, name FROM services
    WHERE tenantId = @tenantId AND branchId = @branchId${activeFilter}
    ORDER BY name ASC`).all({ tenantId: context.access.tenantId, branchId: context.branchId });
}

function appointmentBatch(context, cursor) {
  const params = {
    tenantId: context.access.tenantId,
    branchId: context.branchId,
    fromUtc: context.range.fromUtc,
    toUtc: context.range.toUtc,
    limit: 400,
    ...Object.fromEntries(context.identityIds.map((id, index) => [`staffId${index}`, id]))
  };
  const dateExpr = "date(startAt, '+330 minutes')";
  const filters = [
    "tenantId = @tenantId",
    `staffId IN (${context.identityIds.map((_, index) => `@staffId${index}`).join(", ")})`,
    "startAt >= @fromUtc",
    "startAt < @toUtc"
  ];
  if (context.branchId) filters.push("branchId = @branchId");
  if (cursor) {
    params.cursorDate = cursor.date;
    params.cursorStart = cursor.startAt;
    params.cursorId = cursor.id;
    const direction = context.sort === "asc" ? ">" : "<";
    filters.push(`(${dateExpr} ${direction} @cursorDate OR (${dateExpr} = @cursorDate AND (startAt > @cursorStart OR (startAt = @cursorStart AND id > @cursorId))))`);
  }
  return db.prepare(`SELECT *, ${dateExpr} AS _businessDate
    FROM appointments
    WHERE ${filters.join(" AND ")}
    ORDER BY ${dateExpr} ${context.sort.toUpperCase()}, startAt ASC, id ASC
    LIMIT @limit`).all(params);
}

function enrichBatch(rawRows, context) {
  const appointments = staffLoginService.enrichAppointments(rawRows, context.access.tenantId);
  const logs = rowsByIds("appointment_activity_log", "appointmentId", appointments.map((row) => row.id), context.access, context.branchId);
  const eventsByAppointment = new Map();
  for (const event of logs) {
    if (!eventsByAppointment.has(event.appointmentId)) eventsByAppointment.set(event.appointmentId, []);
    eventsByAppointment.get(event.appointmentId).push(event);
  }

  const sales = context.permissions.billing
    ? rowsByIds("sales", "appointmentId", appointments.map((row) => row.id), context.access, context.branchId)
    : [];
  const saleByAppointment = new Map();
  for (const sale of sales) {
    if (["deleted", "voided"].includes(String(sale.status || "").toLowerCase())) continue;
    if (!saleByAppointment.has(String(sale.appointmentId))) saleByAppointment.set(String(sale.appointmentId), sale);
  }
  const invoices = context.permissions.billing
    ? rowsByIds("invoices", "saleId", [...saleByAppointment.values()].map((sale) => sale.id), context.access, context.branchId)
    : [];
  const invoiceBySale = new Map();
  for (const invoice of invoices) {
    if (["deleted", "voided"].includes(String(invoice.status || "").toLowerCase())) continue;
    if (!invoiceBySale.has(String(invoice.saleId))) invoiceBySale.set(String(invoice.saleId), invoice);
  }
  const attributedItems = context.permissions.billing
    ? attributedSalesItems({
      sales,
      invoices,
      appointments,
      staff: context.identityIds.map((id) => ({ ...context.staff, id }))
    })
    : [];
  const itemsByAppointment = new Map();
  for (const item of attributedItems) {
    const key = String(item.appointmentId || "");
    if (!itemsByAppointment.has(key)) itemsByAppointment.set(key, []);
    itemsByAppointment.get(key).push(item);
  }

  const today = istDate();
  return appointments.map((appointment) => {
    const businessDate = appointment._businessDate || dateFor(appointment.startAt);
    const timer = activityTimer(appointment, eventsByAppointment.get(appointment.id) || [], today);
    const status = String(appointment.status || "booked").toLowerCase();
    const sale = saleByAppointment.get(String(appointment.id));
    const invoice = sale ? invoiceBySale.get(String(sale.id)) : null;
    const billing = context.permissions.billing && sale ? billingDetails(sale, invoice) : null;
    const attribution = context.permissions.billing && sale
      ? attributionDetails(sale, invoice, itemsByAppointment.get(String(appointment.id)) || [], context.identities, appointment)
      : null;
    const start = new Date(appointment.startAt || "").getTime();
    return {
      ...appointment,
      businessDate,
      state: timer.live ? "active" : !terminalStatuses.has(status) && Number.isFinite(start) && start < Date.now() ? "late" : "planned",
      durationMinutes: timer.totalMinutes,
      workedMinutes: completedStatuses.has(status) || timer.live ? timer.elapsedMinutes : 0,
      timer,
      billing,
      attribution
    };
  });
}

function matchesFilters(row, query) {
  const status = String(query.status || "").trim().toLowerCase();
  if (status && status !== "all" && statusGroup(row.status) !== statusGroup(status)) return false;
  const search = String(query.q || "").trim().toLowerCase();
  if (!search) return true;
  return [
    row.clientName,
    ...(row.serviceNames || []),
    row.billing?.invoiceNumber,
    row.billing?.saleId
  ].join(" ").toLowerCase().includes(search);
}

function attendanceFor(context) {
  const overall = { attendanceMinutes: 0, breakMinutes: 0, dutyMinutes: 0 };
  const daily = new Map();
  if (!tableExists("staff_attendance_logs")) return { overall, daily };
  const params = {
    tenantId: context.access.tenantId,
    branchId: context.branchId,
    from: context.range.from,
    to: context.range.to,
    ...Object.fromEntries(context.identityIds.map((id, index) => [`staffId${index}`, id]))
  };
  const filters = [
    "tenant_id = @tenantId",
    `staff_id IN (${context.identityIds.map((_, index) => `@staffId${index}`).join(", ")})`,
    "business_date >= @from",
    "business_date <= @to"
  ];
  if (context.branchId) filters.push("branch_id = @branchId");
  const logs = db.prepare(`SELECT * FROM staff_attendance_logs WHERE ${filters.join(" AND ")}`).all(params);
  const breaks = rowsByIds("staff_breaks", "attendance_id", logs.map((row) => row.id), context.access, context.branchId);
  const breaksByAttendance = new Map();
  for (const item of breaks) {
    if (!breaksByAttendance.has(item.attendance_id)) breaksByAttendance.set(item.attendance_id, []);
    breaksByAttendance.get(item.attendance_id).push(item);
  }
  for (const log of logs) {
    const start = new Date(log.clock_in_at || "").getTime();
    const end = log.clock_out_at ? new Date(log.clock_out_at).getTime() : log.business_date === istDate() ? Date.now() : NaN;
    const attendanceMinutes = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 60000) : 0;
    const breakMinutes = (breaksByAttendance.get(log.id) || []).reduce((sum, item) => {
      const breakStart = new Date(item.started_at || "").getTime();
      const breakEnd = item.ended_at ? new Date(item.ended_at).getTime() : log.business_date === istDate() ? Date.now() : NaN;
      return sum + (Number.isFinite(breakStart) && Number.isFinite(breakEnd) && breakEnd > breakStart ? Math.round((breakEnd - breakStart) / 60000) : 0);
    }, 0);
    const values = {
      attendanceMinutes,
      breakMinutes,
      dutyMinutes: Math.max(0, attendanceMinutes - breakMinutes)
    };
    const day = daily.get(log.business_date) || { attendanceMinutes: 0, breakMinutes: 0, dutyMinutes: 0 };
    for (const key of Object.keys(values)) {
      day[key] += values[key];
      overall[key] += values[key];
    }
    daily.set(log.business_date, day);
  }
  return { overall, daily };
}

function earningsFor(context) {
  if (!context.permissions.earnings) return null;
  const identitySql = context.identityIds.map((_, index) => `@staffId${index}`).join(", ");
  const params = {
    tenantId: context.access.tenantId,
    branchId: context.branchId,
    from: context.range.from,
    to: context.range.to,
    ...Object.fromEntries(context.identityIds.map((id, index) => [`staffId${index}`, id]))
  };
  const branch = context.branchId ? " AND branch_id = @branchId" : "";
  const commissions = tableExists("staff_commissions") ? db.prepare(`SELECT * FROM staff_commissions
    WHERE tenant_id = @tenantId${branch} AND staff_id IN (${identitySql})
      AND period_start <= @to AND period_end >= @from`).all(params) : [];
  const tips = tableExists("staff_tips") ? db.prepare(`SELECT * FROM staff_tips
    WHERE tenant_id = @tenantId${branch} AND staff_id IN (${identitySql})
      AND business_date >= @from AND business_date <= @to`).all(params) : [];
  const tipPayouts = tableExists("tip_payouts") ? db.prepare(`SELECT * FROM tip_payouts
    WHERE tenant_id = @tenantId${branch} AND staff_id IN (${identitySql})
      AND period_start <= @to AND period_end >= @from`).all(params) : [];
  const payrollItems = tableExists("staff_payroll_items") && tableExists("staff_payroll_runs") ? db.prepare(`SELECT i.*, r.period_start, r.period_end, r.status AS run_status
    FROM staff_payroll_items i JOIN staff_payroll_runs r ON r.id = i.payroll_run_id
    WHERE i.tenant_id = @tenantId${context.branchId ? " AND i.branch_id = @branchId" : ""}
      AND i.staff_id IN (${identitySql}) AND r.period_start <= @to AND r.period_end >= @from`).all(params) : [];
  const payrollPayouts = tableExists("payroll_payouts") ? db.prepare(`SELECT * FROM payroll_payouts
    WHERE tenant_id = @tenantId${branch} AND staff_id IN (${identitySql})`).all(params)
    .filter((row) => payrollItems.some((item) => item.payroll_run_id === row.payroll_run_id)) : [];
  const calculatedCommissionPaise = commissions.reduce((sum, row) => sum + rupeesToPaise(row.commission_amount), 0);
  const approvedCommissionPaise = commissions
    .filter((row) => ["approved", "paid", "processed"].includes(String(row.status || "").toLowerCase()))
    .reduce((sum, row) => sum + rupeesToPaise(row.commission_amount), 0);
  const tipsCollectedPaise = tips
    .filter((row) => !["voided", "cancelled", "canceled"].includes(String(row.status || "").toLowerCase()))
    .reduce((sum, row) => sum + rupeesToPaise(row.amount), 0);
  const tipsPaidPaise = tipPayouts
    .filter((row) => ["paid", "processed", "completed"].includes(String(row.status || "").toLowerCase()))
    .reduce((sum, row) => sum + rupeesToPaise(row.amount), 0);
  const payrollGrossPaise = payrollItems.reduce((sum, row) => sum + rupeesToPaise(row.gross_amount), 0);
  const payrollNetPaise = payrollItems.reduce((sum, row) => sum + rupeesToPaise(row.net_amount), 0);
  const payrollPaidPaise = payrollPayouts
    .filter((row) => ["paid", "processed", "completed"].includes(String(row.status || "").toLowerCase()))
    .reduce((sum, row) => sum + rupeesToPaise(row.amount), 0);
  return {
    calculatedCommissionPaise,
    approvedCommissionPaise,
    tipsCollectedPaise,
    tipsPaidPaise,
    tipsPendingPaise: Math.max(0, tipsCollectedPaise - tipsPaidPaise),
    payrollGrossPaise,
    payrollNetPaise,
    payrollPaidPaise,
    payrollPendingPaise: Math.max(0, payrollNetPaise - payrollPaidPaise),
    periods: payrollItems.map((row) => ({
      payrollRunId: row.payroll_run_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      status: row.run_status || row.status,
      grossPaise: rupeesToPaise(row.gross_amount),
      netPaise: rupeesToPaise(row.net_amount)
    }))
  };
}

function targetsFor(context) {
  if (!context.permissions.targets || !tableExists("staff_targets")) return [];
  const params = {
    tenantId: context.access.tenantId,
    from: context.range.from,
    to: context.range.to,
    ...Object.fromEntries(context.identityIds.map((id, index) => [`staffId${index}`, id]))
  };
  const rows = db.prepare(`SELECT * FROM staff_targets
    WHERE tenant_id = @tenantId
      AND staff_id IN (${context.identityIds.map((_, index) => `@staffId${index}`).join(", ")})
      AND period_start <= @to AND period_end >= @from
    ORDER BY period_start DESC, id ASC`).all(params);
  return rows.map((row) => {
    const type = String(row.target_type || "");
    const moneyTarget = /revenue|sales|billing|collection|commission/i.test(type);
    const targetValue = moneyTarget ? rupeesToPaise(row.target_value) : Number(row.target_value || 0);
    const achievedValue = moneyTarget ? rupeesToPaise(row.achieved_value) : Number(row.achieved_value || 0);
    return {
      id: row.id,
      type,
      unit: moneyTarget ? "paise" : /percent|rate|utilization/i.test(type) ? "percent" : "count",
      periodStart: row.period_start,
      periodEnd: row.period_end,
      targetValue,
      achievedValue,
      progressPercent: targetValue > 0 ? Math.round((achievedValue / targetValue) * 1000) / 10 : 0
    };
  });
}

function scan(query, access, options = {}) {
  const context = appointmentContext(query, access);
  const page = positiveInteger(query.page, 1);
  const pageSize = positiveInteger(query.pageSize, 50, 100);
  const startIndex = (page - 1) * pageSize;
  const summary = blankSummary();
  const performance = blankPerformance();
  const daily = new Map();
  const invoiceSeen = new Set();
  const attendance = attendanceFor(context);
  Object.assign(performance, attendance.overall);
  let totalItems = 0;
  let cursor = null;
  const appointments = [];

  while (true) {
    const raw = appointmentBatch(context, cursor);
    if (!raw.length) break;
    const enriched = enrichBatch(raw, context);
    for (const row of enriched) {
      if (!matchesFilters(row, query)) continue;
      const index = totalItems++;
      const day = daily.get(row.businessDate) || { summary: blankSummary(), performance: blankPerformance(), invoiceSeen: new Set() };
      addRow(summary, performance, row, invoiceSeen);
      addRow(day.summary, day.performance, row, day.invoiceSeen);
      daily.set(row.businessDate, day);
      if (index >= startIndex && index < startIndex + pageSize) appointments.push(row);
      options.onRow?.(row, context.permissions);
    }
    const last = raw.at(-1);
    cursor = { date: last._businessDate || dateFor(last.startAt), startAt: last.startAt, id: last.id };
    if (raw.length < 400) break;
  }

  for (const [date, values] of attendance.daily) {
    const day = daily.get(date) || { summary: blankSummary(), performance: blankPerformance(), invoiceSeen: new Set() };
    Object.assign(day.performance, values);
    daily.set(date, day);
  }

  const dailyBreakdown = [...daily.entries()]
    .sort(([left], [right]) => context.sort === "asc" ? left.localeCompare(right) : right.localeCompare(left))
    .map(([date, day]) => ({
      date,
      ...hideSummaryMoney(day.summary, context.permissions.billing),
      performance: finishPerformance(day.performance, context.permissions.billing)
    }));
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return {
    date: String(query.date || context.range.to),
    range: { from: context.range.from, to: context.range.to, timeZone: "Asia/Kolkata" },
    staff: context.staff,
    billingVisible: context.permissions.billing,
    permissions: context.permissions,
    summary: hideSummaryMoney(summary, context.permissions.billing),
    performance: finishPerformance(performance, context.permissions.billing),
    earnings: earningsFor(context),
    targets: targetsFor(context),
    services: branchServicesFor(context),
    dailyBreakdown,
    pagination: { page, pageSize, totalItems, totalPages, hasMore: page < totalPages },
    appointments
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

function csvHeaders(billingVisible) {
  const work = [
    "Date", "Start", "End", "Actual Start", "Actual End", "Time Source", "Overrun Minutes",
    "Client", "Services", "Chair", "Status", "Scheduled Minutes", "Worked Minutes"
  ];
  const billing = [
    "Invoice", "Invoice Status", "Bill Amount INR", "Discount INR", "Coupon Discount INR",
    "After Discount INR", "GST INR", "Total INR", "Paid INR", "Due INR",
    "Attributed Gross INR", "Attributed Discount INR", "Attributed Coupon Discount INR",
    "Attributed After Discount INR", "Attributed GST INR", "Attributed Paid INR", "Attributed Due INR",
    "Service Revenue INR", "Product Revenue INR", "Membership Revenue INR", "Package Revenue INR", "Gift Card Revenue INR"
  ];
  return billingVisible ? [...work, ...billing] : [...work, "Billing"];
}

function csvRow(row, billingVisible) {
  const work = [
    row.businessDate, row.startAt, row.endAt, row.timer.startedAt || "", row.timer.completedAt || "",
    row.timer.timeSource, row.timer.overrunMinutes, row.clientName, (row.serviceNames || []).join(", "),
    row.chair, row.status, row.durationMinutes, row.workedMinutes
  ];
  if (!billingVisible) return [...work, "Restricted"];
  const bill = row.billing;
  const share = row.attribution;
  return [...work,
    bill?.invoiceNumber || "", bill?.invoiceStatus || "",
    moneyInr(bill?.subtotalPaise), moneyInr(bill?.discountPaise), moneyInr(bill?.couponDiscountPaise),
    moneyInr(bill?.afterDiscountPaise), moneyInr(bill?.gstPaise), moneyInr(bill?.totalPaise),
    moneyInr(bill?.paidPaise), moneyInr(bill?.duePaise),
    moneyInr(share?.grossPaise), moneyInr(share?.discountPaise), moneyInr(share?.couponDiscountPaise),
    moneyInr(share?.afterDiscountPaise), moneyInr(share?.gstPaise), moneyInr(share?.paidPaise),
    moneyInr(share?.duePaise), moneyInr(share?.serviceRevenuePaise), moneyInr(share?.productRevenuePaise),
    moneyInr(share?.membershipRevenuePaise), moneyInr(share?.packageRevenuePaise), moneyInr(share?.giftCardRevenuePaise)
  ];
}

function invoiceDetail(invoiceId, access) {
  const context = appointmentContext({}, access);
  if (!context.permissions.invoiceDetail) throw notFound("Invoice not found");
  const invoice = db.prepare(`SELECT * FROM invoices WHERE id = @invoiceId
    AND (tenantId = @tenantId OR tenant_id = @tenantId)
    AND (@branchId = '' OR branchId = @branchId OR branch_id = @branchId)`).get({
    invoiceId,
    tenantId: access.tenantId,
    branchId: context.branchId
  });
  if (!invoice || ["deleted", "voided"].includes(String(invoice.status || "").toLowerCase())) throw notFound("Invoice not found");
  const sale = db.prepare("SELECT * FROM sales WHERE id = @saleId AND tenantId = @tenantId").get({
    saleId: invoice.saleId,
    tenantId: access.tenantId
  });
  const appointmentId = sale?.appointmentId || invoice.appointment_id || "";
  if (!appointmentId) throw notFound("Invoice not found");
  const params = {
    appointmentId,
    tenantId: access.tenantId,
    branchId: context.branchId,
    ...Object.fromEntries(context.identityIds.map((id, index) => [`staffId${index}`, id]))
  };
  const appointment = db.prepare(`SELECT id FROM appointments
    WHERE id = @appointmentId AND tenantId = @tenantId
      AND staffId IN (${context.identityIds.map((_, index) => `@staffId${index}`).join(", ")})
      AND (@branchId = '' OR branchId = @branchId)`).get(params);
  if (!appointment) throw notFound("Invoice not found");
  const clientId = invoice.clientId || invoice.customer_id || sale?.clientId || sale?.customer_id || "";
  const client = clientId ? db.prepare(`SELECT name FROM clients WHERE id = @clientId AND tenantId = @tenantId
    AND (@branchId = '' OR branchId = @branchId)`).get({ clientId, tenantId: access.tenantId, branchId: context.branchId }) : null;
  const totals = billingDetails(sale || {}, invoice);
  const payments = tableExists("payments")
    ? db.prepare("SELECT id, mode, amount, createdAt FROM payments WHERE invoiceId = @invoiceId AND tenantId = @tenantId ORDER BY createdAt ASC").all({
      invoiceId,
      tenantId: access.tenantId
    }).map((payment) => ({ ...payment, amountPaise: moneyPaise(payment, ["amountPaise", "amount"]) }))
    : [];
  return {
    id: invoice.id,
    invoiceNumber: totals.invoiceNumber,
    clientName: client?.name || "",
    status: totals.invoiceStatus,
    appointmentId,
    createdAt: invoice.createdAt || invoice.created_at || "",
    totals,
    items: readArray(invoice.lineItems || sale?.items).map((item, index) => ({
      id: item.id || item.itemId || item.serviceId || item.productId || String(index + 1),
      name: item.name || item.itemName || "Item",
      type: item.type || item.itemType || item.category || "item",
      quantity: Number(item.quantity || item.qty || 1),
      amountPaise: moneyPaise(item, ["finalAmountPaise", "lineTotalPaise", "amountPaise", "totalPaise", "finalAmount", "lineTotal", "amount", "total"])
    })),
    payments
  };
}

export const staffBusinessPerformanceService = {
  daily(query = {}, access = {}) {
    return scan(query, access);
  },

  invoiceDetail(invoiceId, access = {}) {
    return invoiceDetail(String(invoiceId || ""), access);
  },

  csvFilename(query = {}, access = {}) {
    const context = appointmentContext(query, access);
    return `staff-business-${context.range.from}-to-${context.range.to}.csv`;
  },

  csv(query = {}, access = {}) {
    const chunks = [];
    const permissions = permissionsFor(access);
    chunks.push(csvHeaders(permissions.billing).map(csvCell).join(","));
    const report = scan(query, access, {
      onRow(row) {
        chunks.push(csvRow(row, permissions.billing).map(csvCell).join(","));
      }
    });
    return {
      filename: `staff-business-${report.range.from}-to-${report.range.to}.csv`,
      content: chunks.join("\n")
    };
  },

  streamCsv(query = {}, access = {}, write) {
    const context = appointmentContext(query, access);
    write(csvHeaders(context.permissions.billing).map(csvCell).join(",") + "\n");
    scan(query, access, {
      onRow(row) {
        write(csvRow(row, context.permissions.billing).map(csvCell).join(",") + "\n");
      }
    });
    return `staff-business-${context.range.from}-to-${context.range.to}.csv`;
  }
};

export const staffBusinessPerformanceTestUtils = {
  activityTimer,
  allocatePaise,
  businessRange
};
