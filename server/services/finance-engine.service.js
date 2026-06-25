import { db, updateInvoiceStatus } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { salonOperationsService } from "./salon-operations.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

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
