import { db, DEFAULT_TENANT_ID, listRows } from "../db.js";
import { conflict } from "../utils/app-error.js";
import { invoicePaymentCollectionService } from "./invoice-payment-collection.service.js";
import { tenantService } from "./tenant.service.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const closedStatuses = new Set(["closed", "waived", "written_off", "voided", "cancelled", "deleted"]);

function dateMs(value = "") {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function dateKey(value = "") {
  const time = dateMs(value);
  return time ? new Date(time).toISOString().slice(0, 10) : "";
}

function timeLabel(value = "") {
  const time = dateMs(value);
  return time
    ? new Date(time).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    : "";
}

function daysSince(value = "") {
  const time = dateMs(value);
  if (!time) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function agingBucket(days = 0) {
  if (days >= 21) return "21+";
  if (days >= 11) return "11-20";
  return "0-10";
}

function invoiceIdOf(row = {}) {
  return String(row.id || row.invoiceId || row.invoice_id || "");
}

function invoiceBranchId(row = {}, sale = {}) {
  return String(row.branchId || row.branch_id || sale.branchId || sale.branch_id || "");
}

function invoiceTotal(row = {}) {
  return money(row.total ?? row.grandTotal ?? row.grand_total ?? row.final ?? 0);
}

function invoicePaid(row = {}, payments = []) {
  if (row.paid !== undefined || row.paidAmount !== undefined || row.paid_amount !== undefined) {
    return money(row.paid ?? row.paidAmount ?? row.paid_amount ?? 0);
  }
  return money(payments.reduce((sum, payment) => sum + Number(payment.amount || payment.paidAmount || payment.paid_amount || 0), 0));
}

function invoiceDue(row = {}, payments = []) {
  const direct = row.balance ?? row.balanceDue ?? row.balance_due ?? row.dueAmount ?? row.due_amount ?? row.due;
  if (direct !== undefined && direct !== null && direct !== "") return money(Math.max(0, Number(direct)));
  return money(Math.max(0, invoiceTotal(row) - invoicePaid(row, payments)));
}

function paymentDate(payment = {}) {
  return String(payment.paidAt || payment.paid_at || payment.paymentDate || payment.payment_date || payment.createdAt || payment.created_at || payment.date || "");
}

function paymentInvoiceId(payment = {}) {
  return String(payment.invoiceId || payment.invoice_id || "");
}

function lineItemsFor(invoice = {}, sale = {}) {
  const rows = Array.isArray(invoice.lineItems) ? invoice.lineItems : Array.isArray(invoice.line_items) ? invoice.line_items : [];
  if (rows.length) return rows;
  return Array.isArray(sale.items) ? sale.items : [];
}

function serviceNames(items = []) {
  const names = [...new Set(items
    .filter((item) => ["service", "package_redeem"].includes(String(item.type || "")))
    .map((item) => String(item.name || item.serviceName || "").trim())
    .filter(Boolean))];
  return names.join(", ") || "-";
}

function staffNameFor(invoice = {}, sale = {}, staffById = new Map(), items = []) {
  const staffId = String(invoice.staffId || invoice.staff_id || sale.staffId || sale.staff_id || items.find((item) => item.staffId || item.staff_id)?.staffId || items.find((item) => item.staff_id)?.staff_id || "");
  return String(invoice.staffName || invoice.staff_name || sale.staffName || sale.staff_name || staffById.get(staffId)?.name || staffId || "Unassigned");
}

function clientNameFor(invoice = {}, client = {}) {
  return String(invoice.clientName || invoice.client_name || invoice.customerName || invoice.customer_name || client.name || "Walk-in");
}

function clientPhoneFor(invoice = {}, client = {}) {
  return String(invoice.clientPhone || invoice.client_phone || invoice.customerPhone || invoice.customer_phone || invoice.phone || client.phone || client.mobile || client.whatsapp || "");
}

function latestLink(tenantId, invoiceIds = []) {
  if (!invoiceIds.length || !tableExists("invoice_payment_links")) return new Map();
  const invoiceSet = new Set(invoiceIds.map(String));
  const rows = db.prepare(`
    SELECT *
      FROM invoice_payment_links
     WHERE tenant_id = @tenantId
     ORDER BY created_at DESC, id DESC
  `).all({ tenantId });
  const map = new Map();
  for (const row of rows) {
    if (!invoiceSet.has(String(row.invoice_id || ""))) continue;
    if (!map.has(String(row.invoice_id || ""))) map.set(String(row.invoice_id || ""), row);
  }
  return map;
}

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName));
}

function latestPayment(payments = []) {
  return [...payments].sort((a, b) => dateMs(paymentDate(b)) - dateMs(paymentDate(a)))[0] || null;
}

function isRecoveredThisMonth(row = {}) {
  const status = String(row.recoveryStatus || "");
  const latest = String(row.lastPaymentAt || "");
  const month = new Date().toISOString().slice(0, 7);
  return status === "recovered" && latest.startsWith(month);
}

class DueRecoveryReportService {
  report(query = {}, access = {}) {
    const tenantId = access.tenantId || DEFAULT_TENANT_ID;
    const branchId = String(query.branchId || access.branchId || "");
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const from = String(query.from || "").trim();
    const to = String(query.to || "").trim();
    const invoices = listRows("invoices", { tenantId, branchId, limit: Number(query.limit || 10000) || 10000 });
    const sales = listRows("sales", { tenantId, branchId, limit: 10000 });
    const clients = listRows("clients", { tenantId, branchId: "", limit: 10000 });
    const staff = listRows("staff", { tenantId, branchId: "", limit: 10000 });
    const payments = listRows("payments", { tenantId, branchId: "", limit: 10000 });
    const salesById = new Map(sales.map((sale) => [String(sale.id || ""), sale]));
    const clientsById = new Map(clients.map((client) => [String(client.id || ""), client]));
    const staffById = new Map(staff.map((person) => [String(person.id || ""), person]));
    const paymentsByInvoice = new Map();
    for (const payment of payments) {
      const invoiceId = paymentInvoiceId(payment);
      if (!invoiceId) continue;
      paymentsByInvoice.set(invoiceId, [...(paymentsByInvoice.get(invoiceId) || []), payment]);
    }
    const linksByInvoice = latestLink(tenantId, invoices.map(invoiceIdOf).filter(Boolean));

    const rows = invoices.map((invoice) => {
      const invoiceId = invoiceIdOf(invoice);
      const sale = salesById.get(String(invoice.saleId || invoice.sale_id || "")) || {};
      const invoicePayments = paymentsByInvoice.get(invoiceId) || [];
      const client = clientsById.get(String(invoice.clientId || invoice.client_id || "")) || {};
      const items = lineItemsFor(invoice, sale);
      const createdAt = String(invoice.createdAt || invoice.created_at || invoice.date || sale.createdAt || sale.created_at || "");
      const totalAmount = invoiceTotal(invoice);
      const paidAmount = invoicePaid(invoice, invoicePayments);
      const dueAmount = invoiceDue(invoice, invoicePayments);
      const lastPayment = latestPayment(invoicePayments);
      const link = linksByInvoice.get(invoiceId) || {};
      const status = String(invoice.status || invoice.payment_status || "").toLowerCase();
      const recoveryStatus = dueAmount > 0 ? (paidAmount > 0 ? "partial" : "pending") : (lastPayment ? "recovered" : "paid");
      const age = daysSince(createdAt);
      return {
        invoiceId,
        invoiceNumber: String(invoice.invoiceNumber || invoice.invoice_number || invoiceId),
        invoiceDate: dateKey(createdAt),
        invoiceTime: timeLabel(createdAt),
        createdAt,
        branchId: invoiceBranchId(invoice, sale),
        clientId: String(invoice.clientId || invoice.client_id || ""),
        clientName: clientNameFor(invoice, client),
        clientPhone: clientPhoneFor(invoice, client),
        staffName: staffNameFor(invoice, sale, staffById, items),
        serviceNames: serviceNames(items),
        totalAmount,
        paidAmount,
        dueAmount,
        agingDays: age,
        agingBucket: agingBucket(age),
        recoveryStatus,
        invoiceStatus: status,
        closed: closedStatuses.has(status),
        lastPaymentAt: lastPayment ? paymentDate(lastPayment) : "",
        lastReminderSentAt: String(link.sent_at || ""),
        reminderChannel: String(link.sent_channel || ""),
        paymentLinkStatus: String(link.status || (dueAmount > 0 ? "not_sent" : "paid")),
        paymentLinkUrl: String(link.link_url || ""),
        paymentLinkId: String(link.id || "")
      };
    }).filter((row) => this.matches(row, { ...query, from, to }))
      .filter((row) => row.dueAmount > 0 || row.recoveryStatus === "recovered")
      .sort((a, b) => b.dueAmount - a.dueAmount || b.agingDays - a.agingDays);

    return { summary: this.summary(rows), rows };
  }

  matches(row, query = {}) {
    if (query.from && row.invoiceDate < query.from) return false;
    if (query.to && row.invoiceDate > query.to) return false;
    if (query.clientId && String(row.clientId) !== String(query.clientId)) return false;
    if (query.staffId && !String(row.staffName || "").toLowerCase().includes(String(query.staffId).toLowerCase())) return false;
    if (query.agingBucket && row.agingBucket !== query.agingBucket) return false;
    if (query.status && query.status !== "all" && row.recoveryStatus !== query.status) return false;
    const q = String(query.q || query.query || "").trim().toLowerCase();
    if (q) {
      const haystack = `${row.invoiceNumber} ${row.clientName} ${row.clientPhone} ${row.staffName} ${row.serviceNames}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }

  summary(rows = []) {
    const pendingRows = rows.filter((row) => row.dueAmount > 0);
    return {
      totalPendingDue: money(pendingRows.reduce((sum, row) => sum + row.dueAmount, 0)),
      pendingInvoiceCount: pendingRows.length,
      bucket0To10: money(pendingRows.filter((row) => row.agingBucket === "0-10").reduce((sum, row) => sum + row.dueAmount, 0)),
      bucket11To20: money(pendingRows.filter((row) => row.agingBucket === "11-20").reduce((sum, row) => sum + row.dueAmount, 0)),
      bucket21Plus: money(pendingRows.filter((row) => row.agingBucket === "21+").reduce((sum, row) => sum + row.dueAmount, 0)),
      recoveredThisMonth: money(rows.filter(isRecoveredThisMonth).reduce((sum, row) => sum + row.paidAmount, 0))
    };
  }

  sendReminder(invoiceId, payload = {}, access = {}) {
    const current = this.report({ limit: 10000 }, access).rows.find((row) => row.invoiceId === invoiceId);
    if (!current) throw conflict("Invoice is not available in due recovery");
    if (current.dueAmount <= 0) throw conflict("Invoice is already paid. Reminder was not sent.");
    if (!current.clientPhone) throw conflict("Client phone missing");
    if (current.closed) throw conflict("Closed invoices cannot receive reminders");
    const channel = payload.channel || "whatsapp";
    const reminder = invoicePaymentCollectionService.reminder(invoiceId, {
      provider: payload.provider || "razorpay",
      channel,
      messageType: payload.messageType || "payment_link_due_reminder"
    }, access);
    return {
      invoiceId,
      reminderId: reminder.linkId || reminder.paymentLinkId || "",
      channel,
      status: "queued",
      paymentLinkUrl: reminder.paymentLink || "",
      paymentLinkId: reminder.linkId || "",
      sentAt: reminder.sentAt || "",
      queuedAt: new Date().toISOString(),
      dueAmount: current.dueAmount
    };
  }
}

export const dueRecoveryReportService = new DueRecoveryReportService();
