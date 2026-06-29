import { db } from "../db.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

function tableExists(tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @tableName").get({ tableName })
  );
}

function columns(tableName) {
  if (!tableExists(tableName)) return [];
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function firstColumn(columnNames, candidates) {
  return candidates.find((candidate) => columnNames.includes(candidate)) || "";
}

function amountExpr(columnNames, decimalColumn, paiseColumn) {
  if (paiseColumn && columnNames.includes(paiseColumn)) return `COALESCE(${paiseColumn}, 0) / 100.0`;
  if (decimalColumn && columnNames.includes(decimalColumn)) return `COALESCE(${decimalColumn}, 0)`;
  return "0";
}

function dateColumn(columnNames) {
  return firstColumn(columnNames, ["created_at", "createdAt", "closing_date", "businessDate"]);
}

export class BillingFraudDetectionService {
  alerts(query = {}, access = {}) {
    const alerts = [];
    const from = query.from || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = query.to || new Date().toISOString().slice(0, 10);
    const params = { tenantId: access.tenantId, from, to };

    if (tableExists("invoices")) {
      const invoiceColumns = columns("invoices");
      const tenantColumn = firstColumn(invoiceColumns, ["tenant_id", "tenantId"]);
      const createdColumn = dateColumn(invoiceColumns);
      const createdByColumn = firstColumn(invoiceColumns, ["created_by", "createdBy", "userId"]);
      const discountAmount = amountExpr(invoiceColumns, "discount_total", "discount_total_paise");
      if (tenantColumn && createdColumn) {
        const groupColumn = createdByColumn || "'unknown'";
        const discounts = db.prepare(
          `SELECT ${groupColumn} AS userId, COUNT(*) AS count, SUM(${discountAmount}) AS amount
             FROM invoices
            WHERE ${tenantColumn} = @tenantId AND substr(${createdColumn}, 1, 10) BETWEEN @from AND @to
            GROUP BY ${groupColumn} HAVING amount > 10000 OR count > 20`
        ).all(params);
        discounts.forEach((row) => alerts.push({ type: "excessive_discounts", severity: "warning", userId: row.userId || "unknown", amount: money(row.amount), count: row.count }));
      }
    }

    if (tableExists("invoice_voids")) {
      const voidColumns = columns("invoice_voids");
      const tenantColumn = firstColumn(voidColumns, ["tenant_id", "tenantId"]);
      const createdColumn = dateColumn(voidColumns);
      const voidedByColumn = firstColumn(voidColumns, ["voided_by", "voidedBy", "created_by", "createdBy"]);
      if (tenantColumn && createdColumn) {
        const groupColumn = voidedByColumn || "'unknown'";
        const voids = db.prepare(
          `SELECT ${groupColumn} AS userId, COUNT(*) AS count
             FROM invoice_voids
            WHERE ${tenantColumn} = @tenantId AND substr(${createdColumn}, 1, 10) BETWEEN @from AND @to
            GROUP BY ${groupColumn} HAVING count >= 3`
        ).all(params);
        voids.forEach((row) => alerts.push({ type: "excessive_voids", severity: "warning", userId: row.userId || "unknown", count: row.count }));
      }
    }

    if (tableExists("invoice_refunds")) {
      const refundColumns = columns("invoice_refunds");
      const tenantColumn = firstColumn(refundColumns, ["tenant_id", "tenantId"]);
      const createdColumn = dateColumn(refundColumns);
      const processedByColumn = firstColumn(refundColumns, ["processed_by", "processedBy", "approved_by", "approvedBy"]);
      const refundAmount = amountExpr(refundColumns, "amount", "amount_paise");
      if (tenantColumn && createdColumn) {
        const groupColumn = processedByColumn || "'unknown'";
        const refunds = db.prepare(
          `SELECT ${groupColumn} AS userId, COUNT(*) AS count, SUM(${refundAmount}) AS amount
             FROM invoice_refunds
            WHERE ${tenantColumn} = @tenantId AND substr(${createdColumn}, 1, 10) BETWEEN @from AND @to
            GROUP BY ${groupColumn} HAVING amount > 15000 OR count > 5`
        ).all(params);
        refunds.forEach((row) => alerts.push({ type: "refund_abuse", severity: "warning", userId: row.userId || "unknown", amount: money(row.amount), count: row.count }));
      }
    }

    if (tableExists("daily_closing")) {
      const closingColumns = columns("daily_closing");
      const tenantColumn = firstColumn(closingColumns, ["tenant_id", "tenantId"]);
      const branchColumn = firstColumn(closingColumns, ["branch_id", "branchId"]);
      const closingDateColumn = firstColumn(closingColumns, ["closing_date", "business_date", "businessDate"]);
      const differenceColumn = firstColumn(closingColumns, ["difference", "cash_difference", "cashDifference"]);
      if (tenantColumn && closingDateColumn && differenceColumn) {
        const cashMismatch = db.prepare(
          `SELECT id, ${branchColumn || "''"} AS branch_id, ${closingDateColumn} AS closing_date, ${differenceColumn} AS difference
             FROM daily_closing
            WHERE ${tenantColumn} = @tenantId AND ABS(${differenceColumn}) > 0 AND ${closingDateColumn} BETWEEN @from AND @to`
        ).all(params);
        cashMismatch.forEach((row) => alerts.push({ type: "cash_mismatch", severity: "critical", ...row }));
      }
    }

    return alerts;
  }

  resolve(id, payload = {}, access = {}) {
    return { id, resolved: true, resolvedBy: access.userId || "", note: payload.note || "" };
  }
}

export const billingFraudDetectionService = new BillingFraudDetectionService();
