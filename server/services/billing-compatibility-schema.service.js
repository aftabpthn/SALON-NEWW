import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { columnsFor, db } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "db", "migrations");

const compatibilityMigrations = [
  "20260521_enterprise_billing.sql",
  "20260521_corporate_credit_billing.sql",
  "20260521_invoice_event_ledger.sql",
  "20260521_offline_pos_sync.sql",
  "20260521_terminal_device_management.sql"
];

function tableExists(tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @tableName").get({ tableName })
  );
}

function safeColumns(tableName) {
  if (!tableExists(tableName)) return [];
  try {
    return columnsFor(tableName);
  } catch {
    return [];
  }
}

function ensureColumn(tableName, columnName, definition) {
  if (!tableExists(tableName)) return;
  const columns = safeColumns(tableName);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function runAdditiveMigration(fileName) {
  const migrationPath = join(migrationsDir, fileName);
  if (!existsSync(migrationPath)) return;
  const sql = readFileSync(migrationPath, "utf8");
  for (const rawStatement of sql.split(";")) {
    const statement = rawStatement.trim();
    if (!statement) continue;
    try {
      db.exec(`${statement};`);
    } catch (error) {
      const isIndexStatement = /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement.replace(/^--.*$/gm, "").trim());
      const isLegacyColumnGap = /no such column/i.test(error.message || "");
      if (isIndexStatement && isLegacyColumnGap) continue;
      throw error;
    }
  }
}

function ensureInvoiceCompatibilityColumns() {
  const invoiceColumns = {
    tenant_id: "TEXT NOT NULL DEFAULT ''",
    branch_id: "TEXT NOT NULL DEFAULT ''",
    financial_year: "TEXT NOT NULL DEFAULT ''",
    invoice_no: "TEXT NOT NULL DEFAULT ''",
    invoice_type: "TEXT NOT NULL DEFAULT 'tax_invoice'",
    appointment_id: "TEXT",
    customer_id: "TEXT",
    corporate_account_id: "TEXT",
    credit_account_id: "TEXT",
    payment_status: "TEXT NOT NULL DEFAULT 'unpaid'",
    source: "TEXT DEFAULT 'pos'",
    subtotal: "REAL DEFAULT 0",
    discount_total: "REAL DEFAULT 0",
    tax_total: "REAL DEFAULT 0",
    tip_total: "REAL DEFAULT 0",
    round_off: "REAL DEFAULT 0",
    grand_total: "REAL DEFAULT 0",
    paid_amount: "REAL DEFAULT 0",
    due_amount: "REAL DEFAULT 0",
    refund_amount: "REAL DEFAULT 0",
    currency: "TEXT DEFAULT 'INR'",
    terms: "TEXT",
    gstin: "TEXT",
    place_of_supply: "TEXT",
    irn: "TEXT",
    e_invoice_qr: "TEXT",
    e_invoice_ack_no: "TEXT",
    e_invoice_ack_date: "TEXT",
    created_by: "TEXT",
    voided_by: "TEXT",
    void_reason: "TEXT",
    voided_at: "TEXT",
    locked_at: "TEXT",
    finalized_at: "TEXT",
    created_at: "TEXT DEFAULT CURRENT_TIMESTAMP",
    updated_at: "TEXT DEFAULT CURRENT_TIMESTAMP",
    subtotal_paise: "INTEGER NOT NULL DEFAULT 0",
    discount_total_paise: "INTEGER NOT NULL DEFAULT 0",
    tax_total_paise: "INTEGER NOT NULL DEFAULT 0",
    tip_total_paise: "INTEGER NOT NULL DEFAULT 0",
    round_off_paise: "INTEGER NOT NULL DEFAULT 0",
    grand_total_paise: "INTEGER NOT NULL DEFAULT 0",
    paid_amount_paise: "INTEGER NOT NULL DEFAULT 0",
    due_amount_paise: "INTEGER NOT NULL DEFAULT 0",
    refund_amount_paise: "INTEGER NOT NULL DEFAULT 0"
  };
  for (const [column, definition] of Object.entries(invoiceColumns)) {
    ensureColumn("invoices", column, definition);
  }
}

function ensureMoneyPaiseColumns() {
  const paiseColumns = {
    invoice_items: {
      unit_price_paise: "INTEGER NOT NULL DEFAULT 0",
      gross_amount_paise: "INTEGER NOT NULL DEFAULT 0",
      discount_amount_paise: "INTEGER NOT NULL DEFAULT 0",
      taxable_amount_paise: "INTEGER NOT NULL DEFAULT 0",
      tax_amount_paise: "INTEGER NOT NULL DEFAULT 0",
      total_amount_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    invoice_payments: {
      amount_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    invoice_refunds: {
      amount_paise: "INTEGER NOT NULL DEFAULT 0",
      tax_reversal_amount_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    invoice_taxes: {
      taxable_amount_paise: "INTEGER NOT NULL DEFAULT 0",
      tax_amount_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    invoice_discounts: {
      discount_amount_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    invoice_tips: {
      amount_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    invoice_item_margins: {
      revenue_paise: "INTEGER NOT NULL DEFAULT 0",
      product_cost_paise: "INTEGER NOT NULL DEFAULT 0",
      service_consumable_cost_paise: "INTEGER NOT NULL DEFAULT 0",
      staff_commission_paise: "INTEGER NOT NULL DEFAULT 0",
      gross_margin_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    credit_invoices: {
      credit_amount_paise: "INTEGER NOT NULL DEFAULT 0",
      paid_amount_paise: "INTEGER NOT NULL DEFAULT 0",
      outstanding_amount_paise: "INTEGER NOT NULL DEFAULT 0"
    },
    credit_payments: {
      amount_paise: "INTEGER NOT NULL DEFAULT 0"
    }
  };

  for (const [tableName, columns] of Object.entries(paiseColumns)) {
    for (const [columnName, definition] of Object.entries(columns)) {
      ensureColumn(tableName, columnName, definition);
    }
  }
}

function backfillInvoicePaiseColumns() {
  if (!tableExists("invoices")) return;
  const columns = safeColumns("invoices");
  const pairs = [
    ["subtotal", "subtotal_paise"],
    ["discount_total", "discount_total_paise"],
    ["tax_total", "tax_total_paise"],
    ["tip_total", "tip_total_paise"],
    ["round_off", "round_off_paise"],
    ["grand_total", "grand_total_paise"],
    ["paid_amount", "paid_amount_paise"],
    ["due_amount", "due_amount_paise"],
    ["refund_amount", "refund_amount_paise"]
  ].filter(([decimalColumn, paiseColumn]) => columns.includes(decimalColumn) && columns.includes(paiseColumn));

  for (const [decimalColumn, paiseColumn] of pairs) {
    db.exec(`
      UPDATE invoices
         SET ${paiseColumn} = CAST(ROUND(COALESCE(${decimalColumn}, 0) * 100) AS INTEGER)
       WHERE COALESCE(${paiseColumn}, 0) = 0
         AND COALESCE(${decimalColumn}, 0) != 0
    `);
  }
}

export function ensureBillingCompatibilitySchema() {
  ensureInvoiceCompatibilityColumns();
  for (const fileName of compatibilityMigrations) {
    runAdditiveMigration(fileName);
  }
  ensureInvoiceCompatibilityColumns();
  ensureMoneyPaiseColumns();
  backfillInvoicePaiseColumns();
}
