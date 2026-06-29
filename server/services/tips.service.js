import { db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { billingService } from "./billing.service.js";
import { realtimeService } from "./realtime.service.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const toPaise = (value) => Math.round((Number(value) || 0) * 100);
const fromPaise = (value) => money((Number(value) || 0) / 100);
const nowIso = () => new Date().toISOString();
const csvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const tableColumns = new Map();
function columnsFor(table) {
  if (!tableColumns.has(table)) {
    try {
      tableColumns.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)));
    } catch {
      tableColumns.set(table, new Set());
    }
  }
  return tableColumns.get(table);
}

function tableExists(table) {
  return columnsFor(table).size > 0;
}

function column(table, alias, names, fallback = "''") {
  const columns = columnsFor(table);
  const found = names.find((name) => columns.has(name));
  return found ? `${alias}.${found}` : fallback;
}

function coalesce(expressions, fallback = "''") {
  const usable = expressions.filter(Boolean);
  if (!usable.length) return fallback;
  return usable.length === 1 ? usable[0] : `COALESCE(${usable.join(", ")}, ${fallback})`;
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function serviceRevenueFrom(row) {
  const lineItems = safeJson(row.lineItems, []);
  const items = Array.isArray(lineItems) ? lineItems : Array.isArray(lineItems.items) ? lineItems.items : [];
  const serviceTotal = items.reduce((sum, item) => {
    const type = String(item.type || item.itemType || item.category || "").toLowerCase();
    if (type && !type.includes("service")) return sum;
    return sum + Number(item.total || item.net || item.price || item.amount || 0);
  }, 0);
  return money(serviceTotal || row.invoiceTotal || 0);
}

export class TipsService {
  ensurePayoutLedgerSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tip_payout_ledger (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        tipId TEXT NOT NULL,
        invoiceId TEXT NOT NULL,
        staffId TEXT NOT NULL,
        amountPaise INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'collected',
        note TEXT DEFAULT '',
        payoutReference TEXT DEFAULT '',
        createdBy TEXT DEFAULT '',
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tip_payout_ledger_tenant_branch ON tip_payout_ledger(tenantId, branchId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_tip_payout_ledger_tip ON tip_payout_ledger(tenantId, tipId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_tip_payout_ledger_invoice ON tip_payout_ledger(tenantId, invoiceId, createdAt);
    `);
  }

  addTip(invoiceId, payload = {}, access = {}) {
    const invoice = billingService.requireInvoice(invoiceId, access);
    const staffId = payload.staff_id || payload.staffId;
    const amount = money(payload.amount || 0);
    if (!staffId) throw badRequest("staffId is required for tip");
    if (amount <= 0) throw badRequest("Tip amount must be greater than zero");
    const id = `tip_${crypto.randomUUID().slice(0, 12)}`;
    db.prepare(
      `INSERT INTO invoice_tips
        (id, tenant_id, invoice_id, staff_id, amount, payment_mode, tip_pool_id, created_at)
       VALUES
        (@id, @tenantId, @invoiceId, @staffId, @amount, @paymentMode, @tipPoolId, CURRENT_TIMESTAMP)`
    ).run({
      id,
      tenantId: access.tenantId,
      invoiceId,
      staffId,
      amount,
      paymentMode: payload.payment_mode || payload.paymentMode || "cash",
      tipPoolId: payload.tip_pool_id || payload.tipPoolId || ""
    });
    db.prepare("UPDATE invoices SET tip_total = tip_total + ?, grand_total = grand_total + ?, due_amount = due_amount + ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND id = ?")
      .run(amount, amount, amount, access.tenantId, invoiceId);
    billingService.writeEvent({ tenantId: access.tenantId, invoiceId, eventType: "tip.added", actorUserId: access.userId || "", payload: { tipId: id, staffId, amount } });
    realtimeService.broadcast("tip:added", { invoiceId, tipId: id, staffId, amount }, { tenantId: access.tenantId, branchId: invoice.branch_id });
    return { id, invoiceId, staffId, amount };
  }

  report(query = {}, access = {}) {
    this.ensurePayoutLedgerSchema();
    const tenantId = access.tenantId || query.tenantId || "tenant_aura";
    const branchId = query.branchId || query.branch_id || access.branchId || "";
    const params = { tenantId };
    const where = [`it.${columnsFor("invoice_tips").has("tenant_id") ? "tenant_id" : "tenantId"} = @tenantId`];
    const tipDateColumn = columnsFor("invoice_tips").has("created_at") ? "it.created_at" : "it.createdAt";
    if (query.from) {
      where.push(`substr(${tipDateColumn}, 1, 10) >= @from`);
      params.from = query.from;
    }
    if (query.to) {
      where.push(`substr(${tipDateColumn}, 1, 10) <= @to`);
      params.to = query.to;
    }
    if (query.staffId) {
      where.push(`${column("invoice_tips", "it", ["staff_id", "staffId"])} = @staffId`);
      params.staffId = query.staffId;
    }
    const joins = [];
    const invoiceTenant = column("invoices", "i", ["tenant_id", "tenantId"], "");
    const invoiceJoin = invoiceTenant
      ? `i.id = ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])} AND ${invoiceTenant} = @tenantId`
      : `i.id = ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])}`;
    joins.push(`LEFT JOIN invoices i ON ${invoiceJoin}`);
    if (tableExists("sales")) {
      joins.push(`LEFT JOIN sales s ON s.id = ${column("invoices", "i", ["saleId", "sale_id"], "''")}`);
    }
    if (tableExists("clients")) {
      joins.push(`LEFT JOIN clients c ON c.id = ${coalesce([column("invoices", "i", ["clientId", "client_id"], ""), tableExists("sales") ? column("sales", "s", ["clientId", "client_id"], "") : ""], "''")}`);
    }
    if (tableExists("staff")) {
      joins.push(`LEFT JOIN staff st ON st.id = ${column("invoice_tips", "it", ["staff_id", "staffId"])}`);
    }
    if (tableExists("branches")) {
      joins.push(`LEFT JOIN branches b ON b.id = ${coalesce([column("invoices", "i", ["branchId", "branch_id"], ""), tableExists("sales") ? column("sales", "s", ["branchId", "branch_id"], "") : ""], "''")}`);
    }
    const branchExpr = coalesce([
      column("invoices", "i", ["branchId", "branch_id"], ""),
      tableExists("sales") ? column("sales", "s", ["branchId", "branch_id"], "") : ""
    ], "''");
    if (branchId) {
      where.push(`${branchExpr} = @branchId`);
      params.branchId = branchId;
    }
    const queryText = String(query.q || query.search || "").trim().toLowerCase();
    if (queryText) {
      where.push(`LOWER(${[
        column("invoices", "i", ["invoiceNumber", "invoice_number", "invoice_no"], ""),
        column("clients", "c", ["name"], ""),
        column("clients", "c", ["phone", "contact"], ""),
        column("staff", "st", ["name"], "")
      ].filter(Boolean).join(" || ' ' || ") || "''"}) LIKE @q`);
      params.q = `%${queryText}%`;
    }
    if (query.client) {
      where.push(`LOWER(${[column("clients", "c", ["name"], ""), column("clients", "c", ["phone", "contact"], "")].filter(Boolean).join(" || ' ' || ") || "''"}) LIKE @client`);
      params.client = `%${String(query.client).toLowerCase()}%`;
    }
    if (query.invoice) {
      where.push(`LOWER(${coalesce([column("invoices", "i", ["invoiceNumber", "invoice_number", "invoice_no"], ""), column("invoice_tips", "it", ["invoice_id", "invoiceId"], "")], "''")}) LIKE @invoice`);
      params.invoice = `%${String(query.invoice).toLowerCase()}%`;
    }
    if (query.paymentMode) {
      where.push(`${column("invoice_tips", "it", ["payment_mode", "paymentMode"])} = @paymentMode`);
      params.paymentMode = query.paymentMode;
    }

    const paymentsInvoiceColumn = column("payments", "p", ["invoiceId", "invoice_id"], "");
    const paymentSubqueries = tableExists("payments") && paymentsInvoiceColumn
      ? {
          paymentId: `(SELECT p.id FROM payments p WHERE ${paymentsInvoiceColumn} = ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])} ORDER BY ${column("payments", "p", ["createdAt", "created_at"], "p.id")} DESC LIMIT 1)`,
          paymentMode: `(SELECT ${column("payments", "p", ["mode", "paymentMode", "payment_mode"], "''")} FROM payments p WHERE ${paymentsInvoiceColumn} = ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])} ORDER BY ${column("payments", "p", ["createdAt", "created_at"], "p.id")} DESC LIMIT 1)`,
          paymentReference: `(SELECT ${column("payments", "p", ["reference", "referenceNo", "reference_no"], "''")} FROM payments p WHERE ${paymentsInvoiceColumn} = ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])} ORDER BY ${column("payments", "p", ["createdAt", "created_at"], "p.id")} DESC LIMIT 1)`
        }
      : { paymentId: "''", paymentMode: "''", paymentReference: "''" };

    const rawRows = db.prepare(
      `SELECT
          ${column("invoice_tips", "it", ["id"])} AS tipId,
          ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])} AS invoiceId,
          ${column("invoice_tips", "it", ["staff_id", "staffId"])} AS staffId,
          ${column("invoice_tips", "it", ["amount"])} AS amount,
          ${column("invoice_tips", "it", ["payment_mode", "paymentMode"])} AS tipPaymentMode,
          ${column("invoice_tips", "it", ["tip_pool_id", "tipPoolId"])} AS tipPoolId,
          ${tipDateColumn} AS createdAt,
          ${coalesce([column("invoices", "i", ["invoiceNumber", "invoice_number", "invoice_no"], "")], "''")} AS invoiceNumber,
          ${coalesce([column("invoices", "i", ["saleId", "sale_id"], "")], "''")} AS saleId,
          ${coalesce([column("invoices", "i", ["total", "grand_total", "grandTotal"], "")], "0")} AS invoiceTotal,
          ${coalesce([column("invoices", "i", ["paid", "paid_amount", "paidAmount"], "")], "0")} AS paidAmount,
          ${coalesce([column("invoices", "i", ["balance", "due_amount", "dueAmount"], "")], "0")} AS dueAmount,
          ${coalesce([column("invoices", "i", ["status"], "")], "''")} AS invoiceStatus,
          ${coalesce([column("invoices", "i", ["lineItems", "line_items"], "")], "''")} AS lineItems,
          ${tableExists("sales") ? coalesce([column("sales", "s", ["appointmentId", "appointment_id"], "")], "''") : "''"} AS appointmentId,
          ${branchExpr} AS branchId,
          ${tableExists("clients") ? coalesce([column("clients", "c", ["id"], "")], "''") : "''"} AS clientId,
          ${tableExists("clients") ? coalesce([column("clients", "c", ["name"], "")], "''") : "''"} AS clientName,
          ${tableExists("clients") ? coalesce([column("clients", "c", ["phone", "contact"], "")], "''") : "''"} AS clientPhone,
          ${tableExists("staff") ? coalesce([column("staff", "st", ["name"], "")], "''") : "''"} AS staffName,
          ${tableExists("staff") ? coalesce([column("staff", "st", ["phone", "contact"], "")], "''") : "''"} AS staffPhone,
          ${tableExists("staff") ? coalesce([column("staff", "st", ["status"], "")], "''") : "''"} AS staffStatus,
          ${tableExists("branches") ? coalesce([column("branches", "b", ["name"], "")], "''") : "''"} AS branchName,
          ${paymentSubqueries.paymentId} AS settlementPaymentId,
          ${paymentSubqueries.paymentMode} AS settlementPaymentMode,
          ${paymentSubqueries.paymentReference} AS paymentReference
        FROM invoice_tips it
        ${joins.join("\n")}
        WHERE ${where.join(" AND ")}
        ORDER BY ${tipDateColumn} DESC`
    ).all(params);

    const history = db.prepare(
      `SELECT * FROM tip_payout_ledger WHERE tenantId = @tenantId ORDER BY createdAt ASC`
    ).all({ tenantId });
    const latest = new Map();
    for (const entry of history) latest.set(entry.tipId, entry);

    let rows = rawRows.map((row) => {
      const latestLedger = latest.get(row.tipId);
      const createdAt = row.createdAt || "";
      const status = latestLedger?.status === "paid_out"
        ? "paid_out"
        : latestLedger?.status === "reversed"
          ? "reversed"
          : "pending_payout";
      const saleType = row.appointmentId ? "Appointment" : "Quick Sale";
      const amount = money(row.amount || 0);
      return {
        id: row.tipId,
        tipId: row.tipId,
        date: String(createdAt).slice(0, 10),
        time: String(createdAt).slice(11, 19) || "-",
        createdAt,
        invoiceId: row.invoiceId || "",
        invoiceNumber: row.invoiceNumber || row.invoiceId || "-",
        saleId: row.saleId || "",
        saleType,
        clientId: row.clientId || "",
        clientName: row.clientName || "Walk-in",
        clientPhone: row.clientPhone || "-",
        staffId: row.staffId || "",
        staffName: row.staffName || row.staffId || "Unassigned",
        staffPhone: row.staffPhone || "-",
        staffStatus: row.staffStatus || "active",
        receiverStaff: row.staffName || row.staffId || "Unassigned",
        amount,
        amountPaise: toPaise(amount),
        tipAmount: amount,
        tipPaymentMode: row.tipPaymentMode || row.settlementPaymentMode || "cash",
        paymentMode: row.tipPaymentMode || row.settlementPaymentMode || "cash",
        collectedBy: latestLedger?.createdBy || "-",
        settlementPaymentId: row.settlementPaymentId || "-",
        paymentReference: row.paymentReference || "-",
        invoiceTotal: money(row.invoiceTotal || 0),
        paidAmount: money(row.paidAmount || 0),
        dueAmount: money(row.dueAmount || 0),
        invoiceStatus: row.invoiceStatus || "saved",
        tipStatus: status,
        payoutDate: latestLedger?.status === "paid_out" ? latestLedger.createdAt : "",
        payoutReference: latestLedger?.payoutReference || "",
        payoutNote: latestLedger?.note || "",
        branchId: row.branchId || branchId || "",
        branchName: row.branchName || row.branchId || branchId || "-",
        source: row.tipPoolId || "POS",
        serviceRevenue: serviceRevenueFrom(row)
      };
    });
    const invoiceTipKeys = new Set(rows.map((row) => this.tipDuplicateKey(row)));
    const saleRows = this.saleJsonTipRows(query, access, latest)
      .filter((row) => !invoiceTipKeys.has(this.tipDuplicateKey(row)));
    rows = [...rows, ...saleRows];
    rows = rows.filter((row) => this.matchesDerivedFilters(row, query));
    const duplicateMap = this.duplicateMapFromRows(rows);
    const staffSummary = this.staffSummaryFromRows(rows);
    const alerts = this.alertsFromRows(rows, duplicateMap);
    const totalTips = money(rows.reduce((sum, row) => sum + row.amount, 0));
    const cashTips = money(rows.filter((row) => String(row.paymentMode).toLowerCase() === "cash").reduce((sum, row) => sum + row.amount, 0));
    const digitalTips = money(rows.filter((row) => String(row.paymentMode).toLowerCase() !== "cash").reduce((sum, row) => sum + row.amount, 0));
    const paidOutTips = money(rows.filter((row) => row.tipStatus === "paid_out").reduce((sum, row) => sum + row.amount, 0));
    const reversedTips = money(rows.filter((row) => row.tipStatus === "reversed").reduce((sum, row) => sum + row.amount, 0));
    const pendingPayout = money(rows.filter((row) => row.tipStatus === "pending_payout").reduce((sum, row) => sum + row.amount, 0));
    const serviceRevenue = money(rows.reduce((sum, row) => sum + row.serviceRevenue, 0));
    const top = staffSummary[0] || {};
    return {
      summary: {
        totalTips,
        tipCount: rows.length,
        cashTips,
        digitalTips,
        pendingPayout,
        paidOutTips,
        reversedTips,
        topTippedStaff: top.staffName || "-",
        topTippedStaffAmount: top.totalTips || 0,
        averageTipPerInvoice: rows.length ? money(totalTips / new Set(rows.map((row) => row.invoiceId || row.tipId)).size) : 0,
        tipPercentOfServiceRevenue: serviceRevenue ? money((totalTips / serviceRevenue) * 100) : 0,
        serviceRevenue,
        alerts: alerts.length
      },
      rows,
      staffSummary,
      alerts,
      total: totalTips
    };
  }

  saleJsonTipRows(query = {}, access = {}, latest = new Map()) {
    if (!tableExists("sales") || !columnsFor("sales").has("membershipRedeem")) return [];
    const tenantId = access.tenantId || query.tenantId || "tenant_aura";
    const branchId = query.branchId || query.branch_id || access.branchId || "";
    const hasInvoices = tableExists("invoices");
    const saleTenant = column("sales", "s", ["tenantId", "tenant_id"], "");
    const saleCreated = column("sales", "s", ["createdAt", "created_at"], "s.id");
    const saleBranch = column("sales", "s", ["branchId", "branch_id"], "''");
    const saleClient = column("sales", "s", ["clientId", "client_id"], "''");
    const saleStaff = column("sales", "s", ["staffId", "staff_id"], "''");
    const saleItems = column("sales", "s", ["items", "lineItems", "line_items"], "''");
    const saleMembershipRedeem = column("sales", "s", ["membershipRedeem", "membership_redeem"], "''");
    const saleSplitPayments = column("sales", "s", ["splitPayments", "split_payments"], "''");
    const invoiceSaleId = hasInvoices ? column("invoices", "i", ["saleId", "sale_id"], "") : "";
    const invoiceBranch = hasInvoices ? column("invoices", "i", ["branchId", "branch_id"], "") : "";
    const invoiceClient = hasInvoices ? column("invoices", "i", ["clientId", "client_id"], "") : "";
    const invoiceId = hasInvoices ? column("invoices", "i", ["id"], "") : "";
    const invoiceNumber = hasInvoices ? column("invoices", "i", ["invoiceNumber", "invoice_number", "invoice_no"], "") : "";
    const invoiceTotal = hasInvoices ? column("invoices", "i", ["total", "grand_total", "grandTotal"], "") : "";
    const invoicePaid = hasInvoices ? column("invoices", "i", ["paid", "paid_amount", "paidAmount"], "") : "";
    const invoiceDue = hasInvoices ? column("invoices", "i", ["balance", "due_amount", "dueAmount"], "") : "";
    const invoiceStatus = hasInvoices ? column("invoices", "i", ["status"], "") : "";
    const invoiceLineItems = hasInvoices ? column("invoices", "i", ["lineItems", "line_items"], "") : "";
    const invoiceCreated = hasInvoices ? column("invoices", "i", ["createdAt", "created_at"], "") : "";
    const branchExpr = coalesce([invoiceBranch, saleBranch], "''");
    const clientExpr = coalesce([invoiceClient, saleClient], "''");
    const joins = [];
    if (hasInvoices && invoiceSaleId) joins.push(`LEFT JOIN invoices i ON ${invoiceSaleId} = s.id`);
    if (tableExists("clients")) joins.push(`LEFT JOIN clients c ON c.id = ${clientExpr}`);
    if (tableExists("staff")) joins.push(`LEFT JOIN staff st ON st.id = ${saleStaff}`);
    if (tableExists("branches")) joins.push(`LEFT JOIN branches b ON b.id = ${branchExpr}`);

    const where = [];
    const params = {};
    if (saleTenant) {
      where.push(`${saleTenant} = @tenantId`);
      params.tenantId = tenantId;
    }
    if (query.from) {
      where.push(`substr(${saleCreated}, 1, 10) >= @from`);
      params.from = query.from;
    }
    if (query.to) {
      where.push(`substr(${saleCreated}, 1, 10) <= @to`);
      params.to = query.to;
    }
    if (branchId) {
      where.push(`${branchExpr} = @branchId`);
      params.branchId = branchId;
    }

    const rawSales = db.prepare(
      `SELECT
          s.id AS saleId,
          ${saleStaff} AS saleStaffId,
          ${saleMembershipRedeem} AS membershipRedeem,
          ${saleSplitPayments} AS splitPayments,
          ${saleCreated} AS createdAt,
          ${saleItems} AS saleItems,
          ${coalesce([invoiceLineItems, saleItems], "''")} AS lineItems,
          ${coalesce([invoiceId], "''")} AS invoiceId,
          ${coalesce([invoiceNumber], "''")} AS invoiceNumber,
          ${coalesce([invoiceTotal], "0")} AS invoiceTotal,
          ${coalesce([invoicePaid], "0")} AS paidAmount,
          ${coalesce([invoiceDue], "0")} AS dueAmount,
          ${coalesce([invoiceStatus], "''")} AS invoiceStatus,
          ${coalesce([invoiceCreated, saleCreated], "''")} AS invoiceCreatedAt,
          ${column("sales", "s", ["appointmentId", "appointment_id"], "''")} AS appointmentId,
          ${branchExpr} AS branchId,
          ${clientExpr} AS clientId,
          ${tableExists("clients") ? coalesce([column("clients", "c", ["name"], "")], "''") : "''"} AS clientName,
          ${tableExists("clients") ? coalesce([column("clients", "c", ["phone", "contact"], "")], "''") : "''"} AS clientPhone,
          ${tableExists("staff") ? coalesce([column("staff", "st", ["name"], "")], "''") : "''"} AS saleStaffName,
          ${tableExists("staff") ? coalesce([column("staff", "st", ["phone", "contact"], "")], "''") : "''"} AS saleStaffPhone,
          ${tableExists("staff") ? coalesce([column("staff", "st", ["status"], "")], "''") : "''"} AS saleStaffStatus,
          ${tableExists("branches") ? coalesce([column("branches", "b", ["name"], "")], "''") : "''"} AS branchName
        FROM sales s
        ${joins.join("\n")}
        WHERE ${where.length ? where.join(" AND ") : "1 = 1"}
        ORDER BY ${saleCreated} DESC
        LIMIT 5000`
    ).all(params);

    const rows = [];
    for (const sale of rawSales) {
      const redeem = safeJson(sale.membershipRedeem, {});
      const tips = Array.isArray(redeem.tips) ? redeem.tips : [];
      const splitPayments = safeJson(sale.splitPayments, []);
      const payment = Array.isArray(splitPayments) ? splitPayments.find(Boolean) || {} : splitPayments || {};
      tips.forEach((tip, index) => {
        const amount = money(tip?.amount || tip?.tipAmount || 0);
        if (amount <= 0) return;
        const tipId = String(tip.id || tip.tipId || `sale_tip_${sale.saleId}_${index}`);
        const latestLedger = latest.get(tipId);
        const createdAt = sale.invoiceCreatedAt || sale.createdAt || "";
        const status = latestLedger?.status === "paid_out"
          ? "paid_out"
          : latestLedger?.status === "reversed"
            ? "reversed"
            : "pending_payout";
        const staffId = String(tip.staffId || tip.staff_id || sale.saleStaffId || "");
        const staffName = tip.staffName || tip.staff_name || sale.saleStaffName || staffId || "Unassigned";
        const paymentMode = tip.paymentMode || tip.payment_mode || payment.mode || payment.paymentMode || "cash";
        rows.push({
          id: tipId,
          tipId,
          date: String(createdAt).slice(0, 10),
          time: String(createdAt).slice(11, 19) || "-",
          createdAt,
          invoiceId: sale.invoiceId || "",
          invoiceNumber: sale.invoiceNumber || sale.invoiceId || "-",
          saleId: sale.saleId || "",
          saleType: sale.appointmentId ? "Appointment" : "Quick Sale",
          clientId: sale.clientId || "",
          clientName: sale.clientName || "Walk-in",
          clientPhone: sale.clientPhone || "-",
          staffId,
          staffName,
          staffPhone: tip.staffPhone || sale.saleStaffPhone || "-",
          staffStatus: sale.saleStaffStatus || "active",
          receiverStaff: staffName,
          amount,
          amountPaise: toPaise(amount),
          tipAmount: amount,
          tipPaymentMode: paymentMode,
          paymentMode,
          collectedBy: latestLedger?.createdBy || "-",
          settlementPaymentId: tip.paymentId || tip.payment_id || payment.id || payment.paymentId || "-",
          paymentReference: tip.paymentReference || tip.reference || payment.reference || payment.referenceNo || "-",
          invoiceTotal: money(sale.invoiceTotal || 0),
          paidAmount: money(sale.paidAmount || 0),
          dueAmount: money(sale.dueAmount || 0),
          invoiceStatus: sale.invoiceStatus || "saved",
          tipStatus: status,
          payoutDate: latestLedger?.status === "paid_out" ? latestLedger.createdAt : "",
          payoutReference: latestLedger?.payoutReference || "",
          payoutNote: latestLedger?.note || "",
          branchId: sale.branchId || branchId || "",
          branchName: sale.branchName || sale.branchId || branchId || "-",
          source: "POS checkout",
          serviceRevenue: serviceRevenueFrom(sale)
        });
      });
    }
    return rows;
  }

  staffSummary(query = {}, access = {}) {
    const report = this.report(query, access);
    return { summary: report.summary, rows: report.staffSummary };
  }

  payout(payload = {}, access = {}) {
    this.ensurePayoutLedgerSchema();
    const tipIds = Array.isArray(payload.tipIds) ? payload.tipIds.filter(Boolean) : [];
    if (!tipIds.length) throw badRequest("tipIds are required");
    const tenantId = access.tenantId || payload.tenantId || "tenant_aura";
    const placeholders = tipIds.map((_, index) => `@tip${index}`).join(", ");
    const params = Object.fromEntries(tipIds.map((id, index) => [`tip${index}`, id]));
    params.tenantId = tenantId;
    const tenantColumn = columnsFor("invoice_tips").has("tenant_id") ? "tenant_id" : "tenantId";
    const rows = db.prepare(
      `SELECT ${column("invoice_tips", "it", ["id"])} AS tipId,
              ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])} AS invoiceId,
              ${column("invoice_tips", "it", ["staff_id", "staffId"])} AS staffId,
              ${column("invoice_tips", "it", ["amount"])} AS amount,
              ${coalesce([column("invoices", "i", ["branchId", "branch_id"], "")], "''")} AS branchId
         FROM invoice_tips it
         LEFT JOIN invoices i ON i.id = ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])}
        WHERE it.${tenantColumn} = @tenantId AND it.id IN (${placeholders})`
    ).all(params);
    const foundIds = new Set(rows.map((row) => row.tipId));
    const fallbackRows = this.report({}, access).rows
      .filter((row) => tipIds.includes(row.tipId) && !foundIds.has(row.tipId))
      .map((row) => ({
        tipId: row.tipId,
        invoiceId: row.invoiceId || "",
        staffId: row.staffId || "",
        amount: row.amount || 0,
        branchId: row.branchId || access.branchId || ""
      }));
    const payoutRows = [...rows, ...fallbackRows];
    if (!payoutRows.length) throw notFound("Tip not found");
    const insert = db.prepare(
      `INSERT INTO tip_payout_ledger
        (id, tenantId, branchId, tipId, invoiceId, staffId, amountPaise, status, note, payoutReference, createdBy, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @tipId, @invoiceId, @staffId, @amountPaise, @status, @note, @payoutReference, @createdBy, @createdAt)`
    );
    const createdAt = nowIso();
    const write = db.transaction(() => {
      for (const row of payoutRows) {
        insert.run({
          id: `tip_payout_${crypto.randomUUID().slice(0, 12)}`,
          tenantId,
          branchId: row.branchId || access.branchId || "",
          tipId: row.tipId,
          invoiceId: row.invoiceId || "",
          staffId: row.staffId || "",
          amountPaise: toPaise(row.amount),
          status: "paid_out",
          note: payload.note || "",
          payoutReference: payload.payoutReference || "",
          createdBy: access.userId || payload.createdBy || "",
          createdAt
        });
      }
    });
    write();
    return {
      status: "paid_out",
      count: payoutRows.length,
      amount: money(payoutRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
      payoutReference: payload.payoutReference || "",
      createdAt
    };
  }

  markReversed(tipId, payload = {}, access = {}) {
    this.ensurePayoutLedgerSchema();
    const tenantId = access.tenantId || payload.tenantId || "tenant_aura";
    const tenantColumn = columnsFor("invoice_tips").has("tenant_id") ? "tenant_id" : "tenantId";
    let row = db.prepare(
      `SELECT ${column("invoice_tips", "it", ["id"])} AS tipId,
              ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])} AS invoiceId,
              ${column("invoice_tips", "it", ["staff_id", "staffId"])} AS staffId,
              ${column("invoice_tips", "it", ["amount"])} AS amount,
              ${coalesce([column("invoices", "i", ["branchId", "branch_id"], "")], "''")} AS branchId
         FROM invoice_tips it
         LEFT JOIN invoices i ON i.id = ${column("invoice_tips", "it", ["invoice_id", "invoiceId"])}
        WHERE it.${tenantColumn} = @tenantId AND it.id = @tipId`
    ).get({ tenantId, tipId });
    if (!row) {
      const fallback = this.report({}, access).rows.find((tip) => tip.tipId === tipId);
      if (fallback) {
        row = {
          tipId: fallback.tipId,
          invoiceId: fallback.invoiceId || "",
          staffId: fallback.staffId || "",
          amount: fallback.amount || 0,
          branchId: fallback.branchId || access.branchId || ""
        };
      }
    }
    if (!row) throw notFound("Tip not found");
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO tip_payout_ledger
        (id, tenantId, branchId, tipId, invoiceId, staffId, amountPaise, status, note, payoutReference, createdBy, createdAt)
       VALUES
        (@id, @tenantId, @branchId, @tipId, @invoiceId, @staffId, @amountPaise, @status, @note, @payoutReference, @createdBy, @createdAt)`
    ).run({
      id: `tip_reverse_${crypto.randomUUID().slice(0, 12)}`,
      tenantId,
      branchId: row.branchId || access.branchId || "",
      tipId: row.tipId,
      invoiceId: row.invoiceId || "",
      staffId: row.staffId || "",
      amountPaise: toPaise(row.amount),
      status: "reversed",
      note: payload.note || "",
      payoutReference: payload.payoutReference || "",
      createdBy: access.userId || payload.createdBy || "",
      createdAt
    });
    return { tipId, status: "reversed", createdAt };
  }

  exportCsv(query = {}, access = {}) {
    const report = this.report(query, access);
    const headers = ["Date", "Time", "Invoice no", "Sale type", "Client", "Phone", "Staff", "Staff ID", "Tip amount", "Payment mode", "Cashier", "Payment ID", "Invoice total", "Paid", "Due", "Status", "Payout date", "Payout reference", "Branch"];
    const lines = [headers.map(csvValue).join(",")];
    for (const row of report.rows) {
      lines.push([
        row.date, row.time, row.invoiceNumber, row.saleType, row.clientName, row.clientPhone, row.staffName, row.staffId,
        row.amount, row.paymentMode, row.collectedBy, row.settlementPaymentId, row.invoiceTotal, row.paidAmount, row.dueAmount,
        row.tipStatus, row.payoutDate, row.payoutReference, row.branchName
      ].map(csvValue).join(","));
    }
    return lines.join("\n");
  }

  payoutSummaryPdf(query = {}, access = {}) {
    const report = this.report(query, access);
    return Buffer.from([
      "%PDF-1.3",
      "% Staff Tips Payout Summary",
      `Total tips: INR ${report.summary.totalTips}`,
      `Pending payout: INR ${report.summary.pendingPayout}`,
      `Paid out: INR ${report.summary.paidOutTips}`,
      `Alerts: ${report.alerts.length}`,
      "%%EOF"
    ].join("\n"));
  }

  matchesDerivedFilters(row, query) {
    const text = (value) => String(value || "").toLowerCase();
    if (query.from && row.date && row.date < query.from) return false;
    if (query.to && row.date && row.date > query.to) return false;
    if (query.staffId && row.staffId !== query.staffId) return false;
    if (query.branchId && row.branchId !== query.branchId) return false;
    if (query.paymentMode && row.paymentMode !== query.paymentMode) return false;
    if (query.tipStatus && row.tipStatus !== query.tipStatus) return false;
    if (query.saleType && String(row.saleType).toLowerCase().replace(" ", "_") !== query.saleType) return false;
    if (query.cashier && !String(row.collectedBy).toLowerCase().includes(String(query.cashier).toLowerCase())) return false;
    if (query.client) {
      const clientText = `${text(row.clientName)} ${text(row.clientPhone)}`;
      if (!clientText.includes(text(query.client))) return false;
    }
    if (query.invoice) {
      const invoiceText = `${text(row.invoiceNumber)} ${text(row.invoiceId)}`;
      if (!invoiceText.includes(text(query.invoice))) return false;
    }
    const queryText = text(query.q || query.search);
    if (queryText) {
      const haystack = [
        row.invoiceNumber,
        row.invoiceId,
        row.clientName,
        row.clientPhone,
        row.staffName,
        row.staffId,
        row.paymentMode,
        row.branchName
      ].map(text).join(" ");
      if (!haystack.includes(queryText)) return false;
    }
    return true;
  }

  tipDuplicateKey(row) {
    return `${row.invoiceId || row.saleId || ""}:${row.staffId || row.staffName || ""}:${toPaise(row.amount)}:${row.date || ""}`;
  }

  duplicateMapFromRows(rows) {
    const duplicateMap = new Map();
    for (const row of rows) {
      const key = `${row.invoiceId || row.saleId || ""}:${row.staffId || row.staffName || ""}`;
      duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
    }
    return duplicateMap;
  }

  staffSummaryFromRows(rows) {
    const grouped = new Map();
    for (const row of rows) {
      const key = row.staffId || row.staffName;
      const current = grouped.get(key) || {
        staffId: row.staffId,
        staffName: row.staffName,
        tipCount: 0,
        totalTips: 0,
        cashTips: 0,
        digitalTips: 0,
        pendingPayout: 0,
        paidOut: 0,
        serviceRevenue: 0,
        clientIds: new Set()
      };
      current.tipCount += 1;
      current.totalTips += row.amount;
      current.serviceRevenue += row.serviceRevenue;
      if (String(row.paymentMode).toLowerCase() === "cash") current.cashTips += row.amount;
      else current.digitalTips += row.amount;
      if (row.tipStatus === "paid_out") current.paidOut += row.amount;
      if (row.tipStatus === "pending_payout") current.pendingPayout += row.amount;
      if (row.clientId || row.clientPhone) current.clientIds.add(row.clientId || row.clientPhone);
      grouped.set(key, current);
    }
    return [...grouped.values()].map((row) => ({
      staffId: row.staffId,
      staffName: row.staffName,
      tipCount: row.tipCount,
      totalTips: money(row.totalTips),
      cashTips: money(row.cashTips),
      digitalTips: money(row.digitalTips),
      pendingPayout: money(row.pendingPayout),
      paidOut: money(row.paidOut),
      averageTip: row.tipCount ? money(row.totalTips / row.tipCount) : 0,
      serviceRevenue: money(row.serviceRevenue),
      tipToSalePercent: row.serviceRevenue ? money((row.totalTips / row.serviceRevenue) * 100) : 0,
      clients: row.clientIds.size
    })).sort((a, b) => b.totalTips - a.totalTips);
  }

  alertsFromRows(rows, duplicateMap) {
    const alerts = [];
    const push = (alertType, row, riskLevel, suggestedAction) => alerts.push({
      alertType,
      tipId: row.tipId,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      clientName: row.clientName,
      staffName: row.staffName,
      amount: row.amount,
      riskLevel,
      suggestedAction
    });
    for (const row of rows) {
      if (!row.invoiceId || row.invoiceNumber === "-") push("Tip without invoice", row, "high", "Link or reverse this tip");
      if (String(row.staffStatus).toLowerCase().includes("inactive")) push("Tip assigned to inactive staff", row, "medium", "Review staff payout");
      if (row.tipStatus === "pending_payout") push("Tip collected but not paid out", row, "medium", "Include in next payout");
      if (String(row.paymentMode).toLowerCase() === "cash" && row.amount >= 1000) push("High cash tip", row, "medium", "Owner review before payout");
      if (["void", "voided", "cancelled", "deleted", "reversed"].includes(String(row.invoiceStatus).toLowerCase()) && row.tipStatus !== "reversed") {
        push("Reversed invoice but tip still active", row, "high", "Reverse or approve exception");
      }
      if ((duplicateMap.get(`${row.invoiceId || ""}:${row.staffId || ""}`) || 0) > 1) push("Duplicate tip on same invoice", row, "low", "Confirm split or duplicate entry");
    }
    return alerts;
  }
}

export const tipsService = new TipsService();
