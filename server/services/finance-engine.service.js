import { db, updateInvoiceStatus } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { salonOperationsService } from "./salon-operations.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const toPaise = (value) => Math.round((Number(value) || 0) * 100);
const fromPaise = (value) => money((Number(value) || 0) / 100);

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {});
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export class FinanceEngineService {
  summary(query = {}, access) {
    const branchId = query.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const businessDate = query.businessDate || today();
    const listLimit = Math.min(Math.max(Number(query.limit || 250), 25), 500);
    const payments = this.paymentsForDay(branchId, businessDate, access);
    const expenses = repositories.financeExpenses
      .list({ branchId, limit: listLimit }, scope(access, branchId))
      .filter((item) => (item.paidAt || item.createdAt || "").startsWith(businessDate));
    const refunds = repositories.financeRefunds
      .list({ branchId, limit: listLimit }, scope(access, branchId))
      .filter((item) => (item.createdAt || "").startsWith(businessDate));
    const payouts = repositories.financeStaffPayouts.list({ branchId, limit: listLimit }, scope(access, branchId));
    const invoices = repositories.invoices.list({ limit: listLimit }, scope(access));
    const sales = repositories.sales.list({ branchId, limit: listLimit }, scope(access, branchId));
    const outstanding = invoices.filter((invoice) => invoice.status !== "paid");
    const drawer = this.currentDrawer(branchId, access);
    const paymentTotals = this.paymentTotals(payments);
    const expenseTotal = money(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const refundTotal = money(refunds.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const payoutTotal = money(payouts.filter((item) => item.status !== "paid").reduce((sum, item) => sum + Number(item.netAmount || 0), 0));
    const revenue = money(payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0));
    return {
      metrics: {
        revenue,
        cash: paymentTotals.cash || 0,
        upi: paymentTotals.upi || 0,
        card: paymentTotals.card || 0,
        expenses: expenseTotal,
        refunds: refundTotal,
        pendingPayouts: payoutTotal,
        outstanding: money(outstanding.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0)),
        profitLoss: money(revenue - expenseTotal - refundTotal - payoutTotal),
        drawerOpen: drawer ? 1 : 0
      },
      businessDate,
      drawer,
      payments: paymentTotals,
      expenses,
      refunds,
      payouts,
      closings: repositories.financeDailyClosings.list({ branchId, limit: 30 }, scope(access, branchId)),
      outstanding: outstanding.slice(0, 100),
      salesCount: sales.length
    };
  }

  openDrawer(payload = {}, access) {
    const branchId = payload.branchId || access.branchId;
    if (!branchId) throw badRequest("branchId is required");
    tenantService.assertBranchAccess(access, branchId);
    const existing = this.currentDrawer(branchId, access);
    if (existing) throw conflict("Cash drawer is already open for this branch");
    return repositories.financeCashDrawers.create({
      id: makeId("drawer"),
      branchId,
      openedBy: access.userId || "",
      openingFloat: money(payload.openingFloat || 0),
      expectedCash: money(payload.openingFloat || 0),
      status: "open",
      openedAt: now(),
      notes: payload.notes || ""
    }, scope(access, branchId));
  }

  closeDrawer(payload = {}, access) {
    const branchId = payload.branchId || access.branchId;
    if (!branchId) throw badRequest("branchId is required");
    const drawer = this.currentDrawer(branchId, access);
    if (!drawer) throw notFound("No open cash drawer for this branch");
    const payments = this.paymentsForDay(branchId, today(), access);
    const expectedCash = money(Number(drawer.openingFloat || 0) + payments.filter((item) => item.mode === "cash").reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const countedCash = money(payload.countedCash ?? expectedCash);
    return repositories.financeCashDrawers.update(drawer.id, {
      closedBy: access.userId || "",
      expectedCash,
      countedCash,
      variance: money(countedCash - expectedCash),
      status: "closed",
      closedAt: now(),
      notes: payload.notes || drawer.notes
    }, scope(access, branchId));
  }

  addExpense(payload = {}, access) {
    const branchId = payload.branchId || access.branchId;
    if (!branchId || !payload.category || !payload.amount) throw badRequest("branchId, category and amount are required");
    tenantService.assertBranchAccess(access, branchId);
    return repositories.financeExpenses.create({
      id: makeId("exp"),
      branchId,
      category: payload.category,
      vendor: payload.vendor || "",
      amount: money(payload.amount),
      taxAmount: money(payload.taxAmount || 0),
      paymentMode: payload.paymentMode || "cash",
      paidAt: payload.paidAt || now(),
      staffId: payload.staffId || "",
      notes: payload.notes || "",
      status: payload.status || "paid"
    }, scope(access, branchId));
  }

  dailyClosing(payload = {}, access) {
    const branchId = payload.branchId || access.branchId;
    const businessDate = payload.businessDate || today();
    if (!branchId) throw badRequest("branchId is required");
    tenantService.assertBranchAccess(access, branchId);
    const existing = db.prepare("SELECT id FROM finance_daily_closings WHERE tenantId = ? AND branchId = ? AND businessDate = ?").get(access.tenantId, branchId, businessDate);
    const summary = this.summary({ branchId, businessDate }, access);
    const drawer = summary.drawer || null;
    const totals = {
      revenue: summary.metrics.revenue,
      expenses: summary.metrics.expenses,
      refunds: summary.metrics.refunds,
      pendingPayouts: summary.metrics.pendingPayouts,
      profitLoss: summary.metrics.profitLoss,
      outstanding: summary.metrics.outstanding
    };
    const data = {
      branchId,
      businessDate,
      cashDrawerId: drawer?.id || "",
      totals,
      payments: summary.payments,
      expenses: summary.expenses,
      refunds: summary.refunds,
      payouts: summary.payouts,
      variance: Number(drawer?.variance || 0),
      status: "closed",
      notes: payload.notes || ""
    };
    return existing?.id
      ? repositories.financeDailyClosings.update(existing.id, data, scope(access, branchId))
      : repositories.financeDailyClosings.create({ id: makeId("close"), ...data }, scope(access, branchId));
  }

  addPartialPayment(invoiceId, payload = {}, access) {
    if (!payload.amount || !payload.mode) throw badRequest("amount and mode are required");
    return salonOperationsService.addInvoicePayment(invoiceId, payload, access);
  }

  refund(payload = {}, access) {
    if (!payload.invoiceId || !payload.amount) throw badRequest("invoiceId and amount are required");
    const invoice = repositories.invoices.getById(payload.invoiceId, scope(access));
    if (!invoice) throw notFound("Invoice not found");
    const sale = invoice.saleId ? repositories.sales.getById(invoice.saleId, scope(access)) : null;
    if (sale?.branchId) tenantService.assertBranchAccess(access, sale.branchId);
    const paid = Number(invoice.paid || 0);
    const amount = money(payload.amount);
    if (amount <= 0 || amount > paid) throw conflict("Refund amount must be greater than zero and cannot exceed paid amount");
    const payment = repositories.payments.create({
      id: makeId("pay"),
      invoiceId: invoice.id,
      mode: `refund-${payload.mode || "original"}`,
      amount: -Math.abs(amount),
      reference: payload.reference || "refund"
    }, scope(access));
    const updatedInvoice = updateInvoiceStatus(invoice.id, access.tenantId);
    const refund = repositories.financeRefunds.create({
      id: makeId("refund"),
      branchId: sale?.branchId || payload.branchId || "",
      invoiceId: invoice.id,
      saleId: invoice.saleId,
      paymentId: payment.id,
      clientId: invoice.clientId,
      amount,
      mode: payload.mode || "original",
      reason: payload.reason || "",
      status: "processed"
    }, scope(access, sale?.branchId || ""));
    const creditNote = salonOperationsService.createCreditNote({
      invoiceId: invoice.id,
      amount,
      reason: payload.reason || "Refund processed",
      lineItems: payload.lineItems || []
    }, access);
    return { refund, invoice: updatedInvoice, payment, creditNote };
  }

  calculateStaffPayout(payload = {}, access) {
    const staffId = payload.staffId;
    const periodStart = payload.periodStart || today().slice(0, 8) + "01";
    const periodEnd = payload.periodEnd || today();
    if (!staffId) throw badRequest("staffId is required");
    const staff = repositories.staff.getById(staffId, scope(access));
    if (!staff) throw notFound("Staff not found");
    tenantService.assertBranchAccess(access, staff.branchId);
    const sales = repositories.sales.list({ branchId: staff.branchId, limit: 10000 }, scope(access, staff.branchId)).filter((sale) => {
      const date = sale.createdAt?.slice(0, 10);
      return sale.staffId === staffId && date >= periodStart && date <= periodEnd;
    });
    const commissionAmount = money(sales.reduce((sum, sale) => sum + Number(sale.commissionTotal || 0), 0));
    const incentiveAmount = money(payload.incentiveAmount || (sales.length >= 10 ? 500 : 0));
    const deductions = money(payload.deductions || 0);
    const netAmount = money(commissionAmount + incentiveAmount - deductions);
    return repositories.financeStaffPayouts.create({
      id: makeId("payout"),
      branchId: staff.branchId,
      staffId,
      periodStart,
      periodEnd,
      commissionAmount,
      incentiveAmount,
      deductions,
      netAmount,
      status: payload.status || "pending",
      paidAt: payload.status === "paid" ? now() : ""
    }, scope(access, staff.branchId));
  }

  walletLedgerReport(query = {}, access) {
    const filters = this.walletLedgerFilters(query, access);
    const rows = this.walletLedgerRows(filters, access);
    const alerts = this.walletAbuseAlertsFromRows(rows, filters, access);
    return {
      summary: this.walletLedgerSummary(rows, alerts, filters, access),
      rows,
      alerts
    };
  }

  walletAbuseAlerts(query = {}, access) {
    return this.walletLedgerReport(query, access).alerts;
  }

  walletLedgerCsv(query = {}, access) {
    const report = this.walletLedgerReport(query, access);
    const headers = [
      "Date",
      "Time",
      "Client name",
      "Client phone",
      "Branch",
      "Transaction type",
      "Credit amount",
      "Debit amount",
      "Balance after",
      "Reason",
      "Invoice/payment reference",
      "Payment mode",
      "Added by",
      "Source"
    ];
    const rows = report.rows.map((row) => [
      row.date,
      row.time,
      row.clientName,
      row.clientPhone,
      row.branchName,
      row.transactionType,
      row.creditAmount,
      row.debitAmount,
      row.balanceAfter,
      row.reason,
      row.referenceLabel,
      row.paymentMode,
      row.addedBy,
      row.source
    ]);
    return [headers, ...rows].map((row) => row.map((cell) => this.csvCell(cell)).join(",")).join("\n");
  }

  walletAuditPdf(query = {}, access) {
    const report = this.walletLedgerReport(query, access);
    const summary = report.summary || {};
    const lines = [
      "Wallet / Ewallet Ledger Audit",
      `Date range: ${query.fromDate || query.from || "all"} to ${query.toDate || query.to || "all"}`,
      `Branch: ${summary.branchName || "All branches"}`,
      `Total wallet liability: Rs ${summary.totalWalletLiability || 0}`,
      `Transactions: ${summary.transactionCount || 0}`,
      `Credited: Rs ${summary.totalCredited || 0}`,
      `Debited: Rs ${summary.totalDebited || 0}`,
      `Manual adjustments: ${summary.manualAdjustments || 0}`,
      `Abuse alerts: ${summary.abuseAlerts || 0}`,
      "Top alerts:",
      ...report.alerts.slice(0, 35).map((alert) => `${alert.riskLevel}: ${alert.alertType} | ${alert.clientName || "-"} | Rs ${alert.amount || 0} | ${alert.suggestedAction}`)
    ];
    return this.simplePdf(lines);
  }

  walletLedgerFilters(query = {}, access = {}) {
    const branchId = String(query.branchId || access.branchId || "").trim();
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    return {
      tenantId: access.tenantId,
      branchId,
      fromDate: String(query.fromDate || query.from || "").slice(0, 10),
      toDate: String(query.toDate || query.to || "").slice(0, 10),
      client: String(query.client || query.search || "").trim().toLowerCase(),
      staff: String(query.staff || query.user || "").trim().toLowerCase(),
      transactionType: String(query.transactionType || query.type || "").trim().toLowerCase(),
      source: String(query.source || "").trim().toLowerCase(),
      paymentMode: String(query.paymentMode || "").trim().toLowerCase(),
      riskLevel: String(query.riskLevel || "").trim().toLowerCase(),
      limit: Math.min(Math.max(Number(query.limit || 1000), 25), 5000)
    };
  }

  walletLedgerRows(filters, access) {
    const branchClause = filters.branchId ? "AND COALESCE(NULLIF(wt.branchId, ''), c.branchId, '') = @branchId" : "";
    const fromClause = filters.fromDate ? "AND wt.createdAt >= @fromDate" : "";
    const toClause = filters.toDate ? "AND wt.createdAt <= @toDateEnd" : "";
    const rows = db.prepare(`
      SELECT wt.*,
             c.name AS clientName,
             c.phone AS clientPhone,
             c.walletBalance AS clientWalletBalance,
             c.lastVisitAt AS clientLastVisitAt,
             COALESCE(NULLIF(b.name, ''), wt.branchId, c.branchId, '') AS branchName,
             i.invoiceNumber AS invoiceNumber,
             i.id AS invoiceId,
             p.id AS paymentId,
             p.mode AS paymentMode,
             p.reference AS paymentReference,
             pi.invoiceNumber AS paymentInvoiceNumber
        FROM wallet_transactions wt
        LEFT JOIN clients c ON c.tenantId = wt.tenantId AND c.id = wt.clientId
        LEFT JOIN branches b ON b.tenantId = wt.tenantId AND b.id = COALESCE(NULLIF(wt.branchId, ''), c.branchId)
        LEFT JOIN invoices i ON i.tenantId = wt.tenantId AND i.id = wt.referenceId
        LEFT JOIN payments p ON p.tenantId = wt.tenantId AND p.id = wt.referenceId
        LEFT JOIN invoices pi ON pi.tenantId = p.tenantId AND pi.id = p.invoiceId
       WHERE wt.tenantId = @tenantId
         ${branchClause}
         ${fromClause}
         ${toClause}
       ORDER BY wt.createdAt DESC, wt.id DESC
       LIMIT @limit
    `).all({
      tenantId: access.tenantId,
      branchId: filters.branchId,
      fromDate: filters.fromDate,
      toDateEnd: filters.toDate ? `${filters.toDate}T23:59:59.999` : "",
      limit: filters.limit
    });

    return rows.map((row) => this.walletLedgerRow(row)).filter((row) => this.walletLedgerRowMatches(row, filters));
  }

  walletLedgerRow(row = {}) {
    const metadata = this.safeJson(row.metadata, {});
    const amountPaise = toPaise(row.amount);
    const type = this.walletTransactionType(row, amountPaise);
    const isDebit = amountPaise < 0 || ["debit", "use", "redeem", "payment"].includes(type);
    const signedPaise = isDebit ? -Math.abs(amountPaise) : Math.abs(amountPaise);
    const createdAt = row.createdAt || "";
    const referenceType = String(row.referenceType || metadata.referenceType || "").toLowerCase();
    const invoiceNumber = row.invoiceNumber || row.paymentInvoiceNumber || metadata.invoiceNumber || "";
    const paymentId = row.paymentId || metadata.paymentId || "";
    const referenceId = row.referenceId || metadata.referenceId || "";
    const source = this.walletSource(row, metadata, referenceType);
    const addedBy = String(metadata.createdByName || metadata.userName || metadata.createdBy || metadata.userId || row.createdBy || row.created_by || "System");
    return {
      id: row.id,
      date: createdAt ? createdAt.slice(0, 10) : "",
      time: this.timeLabel(createdAt),
      createdAt,
      clientId: row.clientId || "",
      clientName: row.clientName || "Walk In",
      clientPhone: row.clientPhone || "",
      branchId: row.branchId || "",
      branchName: row.branchName || row.branchId || "",
      transactionType: type,
      creditAmount: signedPaise > 0 ? fromPaise(signedPaise) : 0,
      debitAmount: signedPaise < 0 ? fromPaise(Math.abs(signedPaise)) : 0,
      signedAmount: fromPaise(signedPaise),
      balanceAfter: fromPaise(toPaise(row.balanceAfter)),
      reason: row.notes || row.description || metadata.notes || metadata.reason || row.referenceType || row.type || "",
      referenceType,
      referenceId,
      invoiceId: row.invoiceId || metadata.invoiceId || (referenceType === "invoice" ? referenceId : ""),
      invoiceNumber,
      paymentId,
      paymentMode: row.paymentMode || metadata.paymentMode || (source === "wallet" ? "wallet" : ""),
      paymentReference: row.paymentReference || metadata.paymentReference || metadata.referenceNo || "",
      referenceLabel: invoiceNumber ? `Invoice ${invoiceNumber}` : paymentId ? `Payment ${paymentId}` : referenceId || "-",
      addedBy,
      source,
      clientWalletBalance: fromPaise(toPaise(row.clientWalletBalance)),
      clientLastVisitAt: row.clientLastVisitAt || "",
      metadata
    };
  }

  walletLedgerRowMatches(row, filters) {
    const text = `${row.clientName} ${row.clientPhone} ${row.referenceLabel}`.toLowerCase();
    if (filters.client && !text.includes(filters.client)) return false;
    if (filters.staff && !String(row.addedBy || "").toLowerCase().includes(filters.staff)) return false;
    if (filters.transactionType && !String(row.transactionType || "").toLowerCase().includes(filters.transactionType)) return false;
    if (filters.source && !String(row.source || "").toLowerCase().includes(filters.source)) return false;
    if (filters.paymentMode && !String(row.paymentMode || "").toLowerCase().includes(filters.paymentMode)) return false;
    return true;
  }

  walletLedgerSummary(rows = [], alerts = [], filters = {}, access = {}) {
    const liability = this.walletLiability(filters, access);
    const creditedPaise = rows.reduce((sum, row) => sum + toPaise(row.creditAmount), 0);
    const debitedPaise = rows.reduce((sum, row) => sum + toPaise(row.debitAmount), 0);
    return {
      branchId: filters.branchId || "",
      branchName: filters.branchId || "All branches",
      totalWalletLiability: liability.totalWalletLiability,
      clientsWithWalletBalance: liability.clientsWithWalletBalance,
      transactionCount: rows.length,
      totalCredited: fromPaise(creditedPaise),
      totalDebited: fromPaise(debitedPaise),
      netWalletMovement: fromPaise(creditedPaise - debitedPaise),
      manualAdjustments: rows.filter((row) => row.source === "manual" || row.referenceType === "manual").length,
      abuseAlerts: alerts.length
    };
  }

  walletLiability(filters = {}, access = {}) {
    const branchClause = filters.branchId ? "AND branchId = @branchId" : "";
    const row = db.prepare(`
      SELECT COUNT(CASE WHEN COALESCE(walletBalance, 0) > 0 THEN 1 END) AS clientsWithWalletBalance,
             COALESCE(SUM(CASE WHEN COALESCE(walletBalance, 0) > 0 THEN walletBalance ELSE 0 END), 0) AS totalWalletLiability
        FROM clients
       WHERE tenantId = @tenantId ${branchClause}
    `).get({ tenantId: access.tenantId, branchId: filters.branchId || "" }) || {};
    return {
      clientsWithWalletBalance: Number(row.clientsWithWalletBalance || 0),
      totalWalletLiability: fromPaise(toPaise(row.totalWalletLiability))
    };
  }

  walletAbuseAlertsFromRows(rows = [], filters = {}, access = {}) {
    const alerts = [];
    const push = (alert) => alerts.push({
      id: `${alert.alertType}_${alert.reference || alert.clientId || alerts.length}`,
      riskLevel: alert.riskLevel || "medium",
      amount: money(alert.amount || 0),
      points: alert.points || 0,
      staffUser: alert.staffUser || "",
      reference: alert.reference || "",
      suggestedAction: alert.suggestedAction || "Review wallet ledger",
      ...alert
    });

    for (const row of rows) {
      if (row.source === "manual" && row.creditAmount >= 5000) {
        push({ alertType: "Manual high credit", clientId: row.clientId, clientName: row.clientName, amount: row.creditAmount, staffUser: row.addedBy, reference: row.referenceLabel, riskLevel: "high", suggestedAction: "Verify payment proof before owner close" });
      }
      if (row.debitAmount > 0 && !row.invoiceId && !row.paymentId) {
        push({ alertType: "Debit without invoice", clientId: row.clientId, clientName: row.clientName, amount: row.debitAmount, staffUser: row.addedBy, reference: row.referenceLabel, riskLevel: "high", suggestedAction: "Link debit to invoice or reverse" });
      }
      if (row.balanceAfter < 0) {
        push({ alertType: "Negative wallet balance", clientId: row.clientId, clientName: row.clientName, amount: row.balanceAfter, staffUser: row.addedBy, reference: row.referenceLabel, riskLevel: "high", suggestedAction: "Block further wallet use and reconcile" });
      }
      if (row.creditAmount > 0 && row.source === "manual" && !row.referenceId) {
        push({ alertType: "Credit without payment reference", clientId: row.clientId, clientName: row.clientName, amount: row.creditAmount, staffUser: row.addedBy, reference: row.referenceLabel, riskLevel: "medium", suggestedAction: "Attach UPI/card/cash proof" });
      }
      if (row.transactionType === "refund" && row.creditAmount > 0 && !row.invoiceId) {
        push({ alertType: "Refund wallet credit not linked", clientId: row.clientId, clientName: row.clientName, amount: row.creditAmount, staffUser: row.addedBy, reference: row.referenceLabel, riskLevel: "medium", suggestedAction: "Link refund to original invoice" });
      }
    }

    const repeated = new Map();
    for (const row of rows.filter((item) => item.source === "manual")) {
      const key = `${row.addedBy}_${row.clientId}`;
      repeated.set(key, { row, count: Number(repeated.get(key)?.count || 0) + 1 });
    }
    for (const item of repeated.values()) {
      if (item.count >= 3) {
        push({ alertType: "Repeated manual adjustment", clientId: item.row.clientId, clientName: item.row.clientName, amount: item.count, staffUser: item.row.addedBy, reference: item.row.referenceLabel, riskLevel: "medium", suggestedAction: "Review staff adjustment pattern" });
      }
    }

    for (const client of this.oldWalletBalanceClients(filters, access)) {
      push({ alertType: "Old inactive wallet balance", clientId: client.id, clientName: client.name, amount: client.walletBalance, staffUser: "", reference: client.lastWalletActivity || "", riskLevel: "low", suggestedAction: "Send wallet redemption reminder" });
    }

    return filters.riskLevel ? alerts.filter((alert) => alert.riskLevel === filters.riskLevel) : alerts;
  }

  oldWalletBalanceClients(filters = {}, access = {}) {
    const branchClause = filters.branchId ? "AND c.branchId = @branchId" : "";
    return db.prepare(`
      SELECT c.id, c.name, c.walletBalance, MAX(wt.createdAt) AS lastWalletActivity
        FROM clients c
        LEFT JOIN wallet_transactions wt ON wt.tenantId = c.tenantId AND wt.clientId = c.id
       WHERE c.tenantId = @tenantId ${branchClause} AND COALESCE(c.walletBalance, 0) > 0
       GROUP BY c.id
      HAVING COALESCE(lastWalletActivity, '') < datetime('now', '-90 days')
       LIMIT 50
    `).all({ tenantId: access.tenantId, branchId: filters.branchId || "" }).map((row) => ({
      ...row,
      walletBalance: fromPaise(toPaise(row.walletBalance))
    }));
  }

  walletTransactionType(row = {}, amountPaise = 0) {
    const raw = String(row.type || row.referenceType || "").toLowerCase();
    if (raw.includes("refund")) return "refund";
    if (raw.includes("overpay")) return "overpayment";
    if (raw.includes("membership")) return "membership_wallet";
    if (raw.includes("debit") || raw.includes("use") || raw.includes("redeem") || amountPaise < 0) return "debit";
    if (raw.includes("adjust")) return "adjustment";
    return "credit";
  }

  walletSource(row = {}, metadata = {}, referenceType = "") {
    const raw = `${row.type || ""} ${referenceType || ""} ${metadata.source || ""}`.toLowerCase();
    if (raw.includes("invoice") || row.invoiceNumber) return "POS";
    if (raw.includes("membership")) return "membership";
    if (raw.includes("package")) return "package";
    if (raw.includes("refund")) return "refund";
    if (raw.includes("manual")) return "manual";
    return row.referenceId ? "POS" : "manual";
  }

  safeJson(value, fallback) {
    if (!value || typeof value === "object") return value || fallback;
    try {
      return JSON.parse(String(value));
    } catch {
      return fallback;
    }
  }

  timeLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  }

  csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  simplePdf(lines = []) {
    const safeLines = lines.slice(0, 90).map((line) => this.pdfText(line).slice(0, 115));
    const stream = [
      "BT",
      "/F1 11 Tf",
      "50 780 Td",
      "14 TL",
      ...safeLines.flatMap((line) => [`(${line}) Tj`, "T*"]),
      "ET"
    ].join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>\n",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\n",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\n`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n"
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}endobj\n`;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
  }

  pdfText(value) {
    return String(value ?? "").replace(/[()\\]/g, " ").replace(/[^\x20-\x7E]/g, " ");
  }

  currentDrawer(branchId, access) {
    if (!branchId) return null;
    return repositories.financeCashDrawers.list({ branchId, limit: 100 }, scope(access, branchId)).find((item) => item.status === "open") || null;
  }

  paymentsForDay(branchId, businessDate, access) {
    const params = { tenantId: access.tenantId, branchId, start: `${businessDate}T00:00:00`, end: `${businessDate}T23:59:59` };
    const branchClause = branchId ? "AND s.branchId = @branchId" : "";
    return db.prepare(`
      SELECT p.*, s.branchId, i.clientId, i.invoiceNumber
      FROM payments p
      JOIN invoices i ON i.id = p.invoiceId AND i.tenantId = p.tenantId
      JOIN sales s ON s.id = i.saleId AND s.tenantId = p.tenantId
      WHERE p.tenantId = @tenantId ${branchClause} AND p.createdAt BETWEEN @start AND @end
      ORDER BY p.createdAt DESC
    `).all(params);
  }

  paymentTotals(payments = []) {
    return payments.reduce((totals, payment) => {
      const mode = String(payment.mode || "other").replace("refund-", "");
      totals[mode] = money(Number(totals[mode] || 0) + Number(payment.amount || 0));
      totals.total = money(Number(totals.total || 0) + Number(payment.amount || 0));
      return totals;
    }, {});
  }
}

export const financeEngineService = new FinanceEngineService();
