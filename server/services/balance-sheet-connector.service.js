import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { normalizeBusinessDate, istToday } from "../utils/finance-time.js";
import { balanceSheetService } from "./balance-sheet.service.js";
import { ensureHardeningSchema } from "./balance-sheet-hardening-schema.service.js";
import { balanceSheetHardeningService } from "./balance-sheet-hardening.service.js";
import { deferredRevenueService } from "./deferred-revenue.service.js";

const id = (prefix) => `${prefix}_${randomUUID().slice(0, 12)}`;
const rupees = (value) => Math.round((Number(value) || 0) * 100) / 100;
const paise = (value) => Math.round(Number(value || 0) * 100);
const money = (value) => Math.round(Number(value || 0));
const PREPAID_TYPES = new Set(["membership", "package", "gift_card", "giftcard", "prepaid"]);
const sqlIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const tableColumnCache = new Map();

function tableExists(name) {
  return sqlIdentifier.test(name) && Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function tableColumns(name) {
  if (!tableExists(name)) return new Set();
  const cached = tableColumnCache.get(name);
  if (cached) return cached;
  const columns = new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name));
  tableColumnCache.set(name, columns);
  return columns;
}

function selectColumnExpression(columns, names, alias, fallback = "NULL") {
  const found = names.find((name) => columns.has(name));
  return `${found || fallback} AS ${alias}`;
}

function coalesceColumnExpression(columns, names, fallback = "''") {
  const found = names.filter((name) => columns.has(name));
  return found.length ? `COALESCE(${found.join(", ")}, ${fallback})` : fallback;
}

function branchAccess(access = {}, branchId = "") {
  return { ...access, branchId, requestedBranchId: branchId || access.requestedBranchId || "" };
}

function businessDate(value) {
  return normalizeBusinessDate(String(value || istToday()).slice(0, 10), { allowFuture: true });
}

function paymentMode(mode = "") {
  const value = String(mode || "").toLowerCase();
  return value === "cash" ? "cash" : "bank";
}

function productSku(product = {}, productId = "") {
  return String(product.sku || product.code || product.productCode || productId || product.id || "").trim();
}

function productName(product = {}, fallback = "") {
  return String(product.name || product.productName || fallback || "").trim();
}

function accountIdByCode(code, branchId, access) {
  const account = balanceSheetService.accounts({ branchId }, branchAccess(access, branchId)).find((row) => row.code === code);
  return account?.id || "";
}

function safeResult(work, fallback = {}) {
  try {
    return { connected: true, ...work() };
  } catch (error) {
    return { connected: false, error: String(error?.message || error), ...fallback };
  }
}

function lineType(line = {}) {
  return String(line.type || line.itemType || line.item_type || "").toLowerCase();
}

function deferredSourceType(line = {}) {
  const type = lineType(line);
  if (type === "gift_card" || type === "giftcard") return "giftcard";
  if (type === "membership") return "membership";
  if (type === "prepaid") return "prepaid";
  return "package";
}

function lineAmountPaise(line = {}) {
  const direct = line.totalAmount ?? line.total_amount ?? line.total ?? line.amount;
  if (direct !== undefined && direct !== null && direct !== "") return paise(direct);
  const price = Number(line.price ?? line.unitPrice ?? line.unit_price ?? 0);
  const qty = Number(line.quantity ?? line.qty ?? 1) || 1;
  return paise(price * qty);
}

function prepaidLines(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((line) => PREPAID_TYPES.has(lineType(line)))
    .map((line, index) => ({ line, index, amountPaise: lineAmountPaise(line) }))
    .filter((row) => row.amountPaise > 0);
}

function positivePayments(payments = [], invoice = {}) {
  const rows = (Array.isArray(payments) ? payments : [])
    .map((payment) => ({
      id: payment.id || payment.paymentId || "",
      mode: payment.mode || payment.payment_mode || payment.paymentMode || "bank",
      amountPaise: payment.amountPaise !== undefined && payment.amountPaise !== null
        ? money(payment.amountPaise)
        : paise(payment.amount)
    }))
    .filter((payment) => payment.amountPaise > 0);
  if (rows.length) return rows;
  const paid = invoice.paid ?? invoice.paid_amount ?? invoice.paidAmount ?? 0;
  return paise(paid) > 0 ? [{ id: "", mode: "bank", amountPaise: paise(paid) }] : [];
}

function readInvoiceItems(invoice = {}, tenantId = "") {
  const direct = invoice.items || invoice.lineItems || invoice.line_items;
  if (Array.isArray(direct) && direct.length) return direct;
  if (!tenantId || !invoice.id) return [];
  try {
    const enterprise = db.prepare("SELECT * FROM invoice_items WHERE tenant_id = ? AND invoice_id = ?").all(tenantId, invoice.id);
    if (enterprise.length) return enterprise;
  } catch {
    // Legacy POS invoices store lineItems directly on the invoice row.
  }
  try {
    const row = db.prepare("SELECT * FROM invoices WHERE id=?").get(invoice.id);
    const rowTenantId = row?.tenant_id || row?.tenantId || "";
    if (rowTenantId && rowTenantId !== tenantId) return [];
    const raw = row?.lineItems || row?.line_items || "[]";
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function prepaidInvoiceRows({ tenantId, branchId = "", fromDate, toDate, limit = 1000 } = {}) {
  const columns = tableColumns("invoices");
  if (!tenantId || !columns.has("id")) return [];
  const tenantExpr = coalesceColumnExpression(columns, ["tenantId", "tenant_id"], "@tenantId");
  const branchExpr = coalesceColumnExpression(columns, ["branchId", "branch_id"], "''");
  const dateExpr = coalesceColumnExpression(columns, ["createdAt", "created_at", "businessDate", "invoiceDate", "invoice_date", "paidAt", "paid_at"], "@fromDate");
  return db.prepare(`
    SELECT
      ${selectColumnExpression(columns, ["id"], "id", "''")},
      ${selectColumnExpression(columns, ["invoiceNumber", "invoice_no", "invoiceNo", "number"], "invoiceNumber", "''")},
      ${selectColumnExpression(columns, ["branchId", "branch_id"], "branchId", "''")},
      ${selectColumnExpression(columns, ["clientId", "client_id"], "clientId", "''")},
      ${selectColumnExpression(columns, ["saleId", "sale_id"], "saleId", "''")},
      ${selectColumnExpression(columns, ["lineItems", "line_items"], "lineItems", "NULL")},
      ${selectColumnExpression(columns, ["paid", "paidAmount", "paid_amount"], "paid", "NULL")},
      ${selectColumnExpression(columns, ["paidPaise", "paidAmountPaise", "paid_amount_paise"], "paidPaise", "NULL")},
      ${selectColumnExpression(columns, ["createdAt", "created_at", "businessDate", "invoiceDate", "invoice_date", "paidAt", "paid_at"], "createdAt", "@fromDate")}
    FROM invoices
    WHERE ${tenantExpr} = @tenantId
      AND (@branchId = '' OR ${branchExpr} = @branchId)
      AND substr(${dateExpr}, 1, 10) BETWEEN @fromDate AND @toDate
    ORDER BY ${dateExpr} DESC
    LIMIT @limit
  `).all({ tenantId, branchId, fromDate, toDate, limit });
}

function paymentRowsForInvoices({ tenantId, branchId = "", fromDate, toDate, invoiceIds = [] } = {}) {
  const columns = tableColumns("payments");
  if (!tenantId || !invoiceIds.length || (!columns.has("invoiceId") && !columns.has("invoice_id"))) return new Map();
  const tenantExpr = coalesceColumnExpression(columns, ["tenantId", "tenant_id"], "@tenantId");
  const branchExpr = coalesceColumnExpression(columns, ["branchId", "branch_id"], "''");
  const dateExpr = coalesceColumnExpression(columns, ["createdAt", "created_at", "businessDate", "paymentDate", "payment_date", "paidAt", "paid_at"], "@fromDate");
  const rows = db.prepare(`
    SELECT
      ${selectColumnExpression(columns, ["id"], "id", "''")},
      ${selectColumnExpression(columns, ["invoiceId", "invoice_id"], "invoiceId", "''")},
      ${selectColumnExpression(columns, ["mode", "paymentMode", "payment_mode"], "mode", "''")},
      ${selectColumnExpression(columns, ["amount", "paid"], "amount", "NULL")},
      ${selectColumnExpression(columns, ["amountPaise", "paidPaise"], "amountPaise", "NULL")}
    FROM payments
    WHERE ${tenantExpr} = @tenantId
      AND (@branchId = '' OR ${branchExpr} = @branchId)
      AND substr(${dateExpr}, 1, 10) BETWEEN @fromDate AND @toDate
    ORDER BY ${dateExpr} DESC
    LIMIT 10000
  `).all({ tenantId, branchId, fromDate, toDate });
  const wanted = new Set(invoiceIds.map(String));
  const grouped = new Map();
  for (const row of rows) {
    const invoiceId = String(row.invoiceId || "");
    if (!wanted.has(invoiceId)) continue;
    const amountPaise = row.amountPaise !== undefined && row.amountPaise !== null
      ? money(row.amountPaise)
      : paise(row.amount);
    const current = grouped.get(invoiceId) || [];
    current.push({ ...row, amountPaise, amount: rupees(amountPaise) });
    grouped.set(invoiceId, current);
  }
  return grouped;
}

function saleRowForInvoice(invoice = {}, tenantId = "") {
  const saleId = invoice.saleId || invoice.sale_id || "";
  if (!saleId || !tableExists("sales")) return {};
  const columns = tableColumns("sales");
  const tenantExpr = coalesceColumnExpression(columns, ["tenantId", "tenant_id"], "@tenantId");
  try {
    return db.prepare(`
      SELECT
        ${selectColumnExpression(columns, ["id"], "id", "''")},
        ${selectColumnExpression(columns, ["branchId", "branch_id"], "branchId", "''")},
        ${selectColumnExpression(columns, ["clientId", "client_id"], "clientId", "''")},
        ${selectColumnExpression(columns, ["createdAt", "created_at"], "createdAt", "NULL")}
      FROM sales
      WHERE id=@saleId AND ${tenantExpr}=@tenantId
      LIMIT 1
    `).get({ saleId, tenantId }) || {};
  } catch {
    return {};
  }
}

function entitlementSourceType(row = {}) {
  const history = JSON.stringify(row.redeemHistory || row.redeem_history || "").toLowerCase();
  const planName = String(row.planName || row.plan_name || "").toLowerCase();
  if (history.includes("gift_card_sale") || row.code || row.initialValue !== undefined || row.initial_value !== undefined) return "giftcard";
  if (history.includes("package_sale") || planName.startsWith("package:")) return "package";
  if (history.includes("membership_sale") || planName) return "membership";
  return "";
}

function entitlementRowsForSale({ tenantId, branchId = "", saleId = "" } = {}) {
  if (!tenantId || !saleId) return [];
  const rows = [];
  for (const table of ["memberships", "gift_cards"]) {
    const columns = tableColumns(table);
    if (!columns.size || !columns.has("id")) continue;
    const tenantExpr = coalesceColumnExpression(columns, ["tenantId", "tenant_id"], "@tenantId");
    const branchExpr = coalesceColumnExpression(columns, ["branchId", "branch_id"], "''");
    const historyExpr = coalesceColumnExpression(columns, ["redeemHistory", "redeem_history"], "''");
    const createdExpr = coalesceColumnExpression(columns, ["createdAt", "created_at"], "''");
    const selected = db.prepare(`
      SELECT
        ${selectColumnExpression(columns, ["id"], "id", "''")},
        ${selectColumnExpression(columns, ["planName", "plan_name"], "planName", "''")},
        ${selectColumnExpression(columns, ["code"], "code", "''")},
        ${selectColumnExpression(columns, ["initialValue", "initial_value"], "initialValue", "NULL")},
        ${selectColumnExpression(columns, ["redeemHistory", "redeem_history"], "redeemHistory", "'[]'")},
        ${selectColumnExpression(columns, ["createdAt", "created_at"], "createdAt", "''")}
      FROM ${table}
      WHERE ${tenantExpr}=@tenantId
        AND (@branchId='' OR ${branchExpr}=@branchId)
        AND instr(${historyExpr}, @saleId) > 0
      ORDER BY ${createdExpr} ASC
      LIMIT 50
    `).all({ tenantId, branchId, saleId });
    rows.push(...selected.map((row) => ({ ...row, sourceType: entitlementSourceType(row) })));
  }
  return rows;
}

function matchingEntitlement(entitlements = [], sourceType = "", used = new Set()) {
  const index = entitlements.findIndex((row, idx) => !used.has(idx) && (row.sourceType || entitlementSourceType(row)) === sourceType);
  if (index === -1) return null;
  used.add(index);
  return entitlements[index];
}

function seedOpeningInventory({ sku, name, branchId, seedQtyOnHand, unitCostPaise, requiredQty, access }) {
  ensureHardeningSchema();
  const tenantId = access.tenantId;
  if (!tenantId || !sku) return { seeded: false };
  const item = balanceSheetHardeningService.ensureItem(tenantId, branchId, sku, name);
  const currentQty = Number(item.qtyOnHand || 0);
  if (currentQty >= requiredQty) return { seeded: false };
  const targetQty = Math.max(Number(seedQtyOnHand || 0), requiredQty);
  if (targetQty <= currentQty) return { seeded: false };
  const addQty = rupees(targetQty - currentQty);
  const costPaise = money(unitCostPaise || item.wmaCostPaise || 0);
  const addValue = money(addQty * costPaise);
  const qtyAfter = rupees(currentQty + addQty);
  const valueAfter = money(Number(item.totalValuePaise || 0) + addValue);
  const wmaAfter = qtyAfter > 0 ? Math.round(valueAfter / qtyAfter) : costPaise;
  balanceSheetHardeningService.writeItem(tenantId, branchId, sku, qtyAfter, wmaAfter, valueAfter);
  balanceSheetHardeningService.writeMovement({
    tenantId,
    branchId,
    sku,
    movementType: "in",
    qty: addQty,
    unitCostPaise: costPaise,
    totalCostPaise: addValue,
    wmaCostAfterPaise: wmaAfter,
    qtyAfter,
    valueAfterPaise: valueAfter,
    sourceType: "legacy.opening-sync",
    sourceId: sku,
    businessDate: istToday()
  });
  if (addValue > 0) {
    const inventoryAccountId = accountIdByCode("1200", branchId, access);
    const capitalAccountId = accountIdByCode("3000", branchId, access);
    if (inventoryAccountId && capitalAccountId) {
      balanceSheetService.createJournal({
        branchId,
        businessDate: istToday(),
        sourceType: "inventory.opening-sync",
        sourceId: sku,
        memo: `Opening inventory sync ${sku}`,
        idempotencyKey: `inventory-opening-sync:${tenantId}:${branchId}:${sku}`,
        lines: [
          { accountId: inventoryAccountId, debitPaise: addValue },
          { accountId: capitalAccountId, creditPaise: addValue }
        ]
      }, branchAccess(access, branchId));
    }
  }
  return { seeded: true, qty: addQty, valuePaise: addValue };
}

function createDeferredSchedules({ invoice = {}, sale = {}, payments = [], items = [], entitlements = [] } = {}, access = {}) {
  const branchId = sale.branchId || sale.branch_id || invoice.branchId || invoice.branch_id || access.requestedBranchId || "";
  const rows = prepaidLines(items.length ? items : readInvoiceItems(invoice, access.tenantId));
  if (!rows.length) return { deferredPaise: 0, schedules: [] };
  const payRows = positivePayments(payments, invoice);
  let remainingPaidPaise = payRows.reduce((sum, row) => sum + row.amountPaise, 0);
  const mode = paymentMode(payRows[0]?.mode || "bank");
  const schedules = [];
  let deferredPaise = 0;
  const usedEntitlements = new Set();
  for (const row of rows) {
    if (remainingPaidPaise <= 0) break;
    const scheduledPaise = Math.min(row.amountPaise, remainingPaidPaise);
    remainingPaidPaise -= scheduledPaise;
    deferredPaise += scheduledPaise;
    const line = row.line;
    const sourceType = deferredSourceType(line);
    const entitlement = matchingEntitlement(entitlements, sourceType, usedEntitlements);
    const sourceId = entitlement?.id || `${invoice.id || sale.id || "pos"}:${sourceType}:${line.id || line.item_id || row.index}`;
    const schedule = deferredRevenueService.createSchedule({
      branchId,
      sourceType,
      sourceId,
      customerId: invoice.clientId || invoice.client_id || sale.clientId || sale.client_id || "",
      totalPaise: scheduledPaise,
      method: sourceType === "giftcard" || sourceType === "prepaid" ? "on_usage" : "straight_line",
      periods: Number(line.periods || line.validityMonths || 1) || 1,
      startDate: businessDate(invoice.createdAt || invoice.created_at || sale.createdAt || sale.created_at),
      paymentMode: mode,
      memo: `${sourceType} sale ${line.name || line.item_name || sourceId}`
    }, branchAccess(access, branchId));
    schedules.push(schedule);
  }
  return { deferredPaise, schedules };
}

export const balanceSheetConnector = {
  connectInventoryPurchase(payload = {}, access = {}) {
    return safeResult(() => {
      const product = payload.product || {};
      const branchId = payload.branchId || product.branchId || product.branch_id || access.requestedBranchId || "";
      const sku = productSku(product, payload.productId);
      const qty = Number(payload.quantity || payload.qty || 0);
      const unitCostPaise = paise(payload.unitCost ?? product.unitCost ?? product.unit_cost ?? 0);
      const inventoryPaise = money(qty * unitCostPaise);
      const taxPaise = paise(payload.taxAmount ?? payload.gstAmount ?? payload.gst_amount ?? 0);
      const explicitPayablePaise = paise(payload.payableAmount ?? payload.lineTotal ?? payload.line_total ?? payload.totalAmount ?? 0);
      if (!sku || !branchId || qty <= 0) return { skipped: true };
      const result = balanceSheetHardeningService.receiveStock({
        branchId,
        sku,
        name: productName(product, sku),
        qty,
        unitCostPaise,
        taxPaise,
        payablePaise: explicitPayablePaise || inventoryPaise + taxPaise,
        supplierId: payload.supplierId || payload.supplier_id || "",
        sourceType: payload.sourceType || "inventory.purchase",
        sourceId: payload.sourceId || payload.transaction?.id || payload.batch?.id || payload.batchId || "",
        businessDate: businessDate(payload.businessDate || payload.createdAt),
        mode: paymentMode(payload.mode),
        settled: payload.settled !== false,
        memo: payload.memo || payload.reason || ""
      }, branchAccess(access, branchId));
      return { inventory: result };
    });
  },

  connectInventoryIssue(payload = {}, access = {}) {
    return safeResult(() => {
      const product = payload.product || {};
      const branchId = payload.branchId || product.branchId || product.branch_id || access.requestedBranchId || "";
      const sku = productSku(product, payload.productId);
      const qty = Number(payload.quantity || payload.qty || 0);
      const unitCostPaise = paise(payload.unitCost ?? product.unitCost ?? product.unit_cost ?? 0);
      if (!sku || !branchId || qty <= 0) return { skipped: true };
      const seed = seedOpeningInventory({
        sku,
        name: productName(product, sku),
        branchId,
        seedQtyOnHand: Number(payload.seedQtyOnHand ?? product.stock ?? product.qtyOnHand ?? 0),
        unitCostPaise,
        requiredQty: qty,
        access: branchAccess(access, branchId)
      });
      const result = balanceSheetHardeningService.issueStock({
        branchId,
        sku,
        name: productName(product, sku),
        qty,
        sourceType: payload.sourceType || payload.referenceType || "inventory.issue",
        sourceId: payload.sourceId || payload.referenceId || payload.transaction?.id || "",
        businessDate: businessDate(payload.businessDate || payload.createdAt)
      }, branchAccess(access, branchId));
      return { openingSync: seed, inventory: result };
    });
  },

  connectPosCheckout(payload = {}, access = {}) {
    return safeResult(() => {
      const { sale = {}, invoice = {}, payments = [], items = [], entitlements = [] } = payload;
      const branchId = sale.branchId || sale.branch_id || invoice.branchId || invoice.branch_id || access.requestedBranchId || "";
      const deferred = createDeferredSchedules({ invoice, sale, payments, items, entitlements }, access);
      const paidPaise = positivePayments(payments, invoice).reduce((sum, row) => sum + row.amountPaise, 0);
      const revenuePaise = Math.max(0, paidPaise - deferred.deferredPaise);
      let outbox = null;
      if (revenuePaise > 0) {
        outbox = balanceSheetHardeningService.enqueue({
          branchId,
          eventType: "invoice.paid",
          eventKey: `invoice.paid:${access.tenantId}:${branchId}:${invoice.id}`,
          businessDate: businessDate(invoice.createdAt || sale.createdAt),
          data: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber || invoice.invoice_no || "",
            amountPaise: revenuePaise,
            mode: paymentMode(payments[0]?.mode || payments[0]?.payment_mode),
            revenueCode: "4000",
            memo: `POS invoice ${invoice.invoiceNumber || invoice.id}`
          }
        }, branchAccess(access, branchId));
      }
      return { outbox, deferred };
    });
  },

  connectDeferredRevenueForInvoice(payload = {}, access = {}) {
    return safeResult(() => {
      const { invoice = {}, sale = {}, payments = [], entitlements = [] } = payload;
      const items = payload.items || readInvoiceItems(invoice, access.tenantId);
      const deferred = createDeferredSchedules({ invoice, sale, payments, items, entitlements }, access);
      return { deferred };
    });
  },

  syncPrepaidAdvances(payload = {}, access = {}) {
    return safeResult(() => {
      const tenantId = access.tenantId;
      if (!tenantId) return { skipped: true, reason: "missing_tenant" };
      const branchId = payload.branchId || access.requestedBranchId || "";
      const asOfDate = businessDate(payload.businessDate || payload.asOfDate || istToday());
      const fromDate = String(payload.fromDate || asOfDate).slice(0, 10);
      const toDate = businessDate(payload.toDate || asOfDate);
      const invoices = prepaidInvoiceRows({ tenantId, branchId, fromDate, toDate, limit: 10000 });
      const paymentsByInvoice = paymentRowsForInvoices({
        tenantId,
        branchId,
        fromDate,
        toDate,
        invoiceIds: invoices.map((invoice) => invoice.id)
      });
      const summary = {
        fromDate,
        toDate,
        scanned: invoices.length,
        prepaidInvoices: 0,
        created: 0,
        duplicate: 0,
        skipped: 0,
        deferred: 0,
        schedules: []
      };
      if (!tableExists("deferredSchedules")) {
        deferredRevenueService.list({ branchId }, branchAccess(access, branchId));
      }
      for (const invoice of invoices) {
        const items = readInvoiceItems(invoice, tenantId);
        const rows = prepaidLines(items);
        if (!rows.length) {
          summary.skipped += 1;
          continue;
        }
        summary.prepaidInvoices += 1;
        const payments = paymentsByInvoice.get(String(invoice.id || "")) || [];
        const sale = saleRowForInvoice(invoice, tenantId);
        const saleId = invoice.saleId || invoice.sale_id || sale.id || "";
        const entitlements = entitlementRowsForSale({ tenantId, branchId: invoice.branchId || branchId, saleId });
        const before = db.prepare("SELECT COUNT(*) AS n FROM deferredSchedules WHERE tenantId=?").get(tenantId).n;
        const deferred = createDeferredSchedules({ invoice, sale, payments, items, entitlements }, access);
        const after = db.prepare("SELECT COUNT(*) AS n FROM deferredSchedules WHERE tenantId=?").get(tenantId).n;
        const created = Math.max(0, after - before);
        summary.created += created;
        summary.duplicate += Math.max(0, (deferred.schedules || []).length - created);
        summary.deferred += rupees(deferred.deferredPaise || 0);
        summary.schedules.push(...(deferred.schedules || []).map((schedule) => ({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber || invoice.id,
          sourceType: schedule.sourceType,
          sourceId: schedule.sourceId,
          deferredBalance: schedule.deferredBalance,
          status: created > 0 ? "created_or_active" : "existing"
        })));
      }
      return summary;
    });
  },

  connectClassicInvoicePayment({ invoice = {}, payment = {} } = {}, access = {}) {
    return safeResult(() => {
      const branchId = invoice.branchId || invoice.branch_id || access.requestedBranchId || "";
      const amountPaise = paise(payment.amount);
      if (!invoice.id || amountPaise <= 0) return { skipped: true };
      const outbox = balanceSheetHardeningService.enqueue({
        branchId,
        eventType: "invoice.paid",
        eventKey: `invoice.paid:${access.tenantId}:${branchId}:${invoice.id}:${payment.id || id("payment")}`,
        businessDate: businessDate(payment.createdAt || invoice.updatedAt || invoice.createdAt),
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber || "",
          amountPaise,
          mode: paymentMode(payment.mode),
          revenueCode: "4000",
          memo: `Invoice payment ${invoice.invoiceNumber || invoice.id}`
        }
      }, branchAccess(access, branchId));
      return { outbox };
    });
  }
};
