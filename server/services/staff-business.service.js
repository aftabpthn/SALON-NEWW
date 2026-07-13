import { columnsFor, db } from "../db.js";
import { can } from "../middleware/rbac.js";
import { badRequest } from "../utils/app-error.js";
import { staffLoginService } from "./staff-login.service.js";

const completedStatuses = new Set(["completed", "checked-out"]);
const activeStatuses = new Set(["in-service", "in service", "started", "active", "running"]);

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
  if (!ids.length) return [];
  const columns = columnsFor(table);
  const params = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
  const filters = [`${column} IN (${ids.map((_, index) => `@id${index}`).join(", ")})`];
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

export const staffBusinessService = {
  daily(query = {}, access = {}) {
    const date = businessDate(query.date);
    const dashboard = staffLoginService.staffDashboard({ ...query, date }, access);
    const enterprise = staffLoginService.enterpriseOs({ ...query, date }, access);
    const appointments = dashboard.todayAppointments || [];
    const appointmentIds = appointments.map((item) => item.id).filter(Boolean);
    const branchId = dashboard.staff.branchId || access.branchId || "";
    const billingVisible = ["finance", "sales", "payments", "invoices"].some((resource) => can(access.role || "staff", "read", resource, access));
    const sales = billingVisible ? rowsByIds("sales", "appointmentId", appointmentIds, access, branchId) : [];
    const saleByAppointment = new Map();
    sales.forEach((sale) => { if (!saleByAppointment.has(sale.appointmentId)) saleByAppointment.set(sale.appointmentId, sale); });
    const invoices = billingVisible ? rowsByIds("invoices", "saleId", sales.map((sale) => sale.id).filter(Boolean), access, branchId) : [];
    const invoiceBySale = new Map();
    invoices.forEach((invoice) => { if (!invoiceBySale.has(invoice.saleId)) invoiceBySale.set(invoice.saleId, invoice); });
    const timerByAppointment = new Map((enterprise.serviceTimers || []).map((timer) => [timer.appointmentId, timer]));
    const timelineByAppointment = new Map((enterprise.timeline || []).map((item) => [item.id, item]));

    const rows = appointments.map((appointment) => {
      const status = String(appointment.status || "booked").toLowerCase();
      const timer = timerByAppointment.get(appointment.id) || {
        appointmentId: appointment.id,
        clientName: appointment.clientName,
        status,
        elapsedMinutes: 0,
        totalMinutes: Number(appointment.durationMinutes || 0),
        remainingMinutes: Number(appointment.durationMinutes || 0),
        progress: 0
      };
      const sale = saleByAppointment.get(appointment.id);
      const billing = billingVisible && sale ? billingDetails(sale, invoiceBySale.get(sale.id)) : null;
      const durationMinutes = Number(appointment.durationMinutes || timer.totalMinutes || 0);
      const workedMinutes = completedStatuses.has(status)
        ? durationMinutes
        : activeStatuses.has(status) ? Math.min(durationMinutes, Number(timer.elapsedMinutes || 0)) : 0;
      return {
        ...appointment,
        state: timelineByAppointment.get(appointment.id)?.state || "planned",
        durationMinutes,
        workedMinutes,
        timer,
        billing
      };
    });

    const billingRows = rows.map((row) => row.billing).filter(Boolean);
    return {
      date,
      staff: dashboard.staff,
      billingVisible,
      summary: {
        appointments: rows.length,
        completedServices: rows
          .filter((row) => completedStatuses.has(String(row.status || "").toLowerCase()))
          .reduce((sum, row) => sum + Math.max(1, row.serviceNames?.length || 0), 0),
        scheduledMinutes: rows.reduce((sum, row) => sum + row.durationMinutes, 0),
        completedMinutes: rows
          .filter((row) => completedStatuses.has(String(row.status || "").toLowerCase()))
          .reduce((sum, row) => sum + row.durationMinutes, 0),
        workedMinutes: rows.reduce((sum, row) => sum + row.workedMinutes, 0),
        bills: billingRows.length,
        subtotalPaise: billingRows.reduce((sum, bill) => sum + bill.subtotalPaise, 0),
        discountPaise: billingRows.reduce((sum, bill) => sum + bill.discountPaise, 0),
        couponDiscountPaise: billingRows.reduce((sum, bill) => sum + bill.couponDiscountPaise, 0),
        afterDiscountPaise: billingRows.reduce((sum, bill) => sum + bill.afterDiscountPaise, 0),
        gstPaise: billingRows.reduce((sum, bill) => sum + bill.gstPaise, 0),
        totalPaise: billingRows.reduce((sum, bill) => sum + bill.totalPaise, 0),
        paidPaise: billingRows.reduce((sum, bill) => sum + bill.paidPaise, 0),
        duePaise: billingRows.reduce((sum, bill) => sum + bill.duePaise, 0)
      },
      appointments: rows
    };
  }
};
