import { columnsFor, db } from "../db.js";

let ensured = false;

const TARGET_TABLES = [
  "clients",
  "staff",
  "services",
  "products",
  "inventory_transactions",
  "suppliers",
  "finance_expenses",
  "memberships",
  "appointments",
  "sales",
  "invoices",
  "payments"
];

const MIGRATION_COLUMNS = [
  ["imported", "INTEGER DEFAULT 0"],
  ["originalSystem", "TEXT DEFAULT ''"],
  ["originalRecordId", "TEXT DEFAULT ''"],
  ["importedAt", "TEXT DEFAULT ''"],
  ["importBatchId", "TEXT DEFAULT ''"]
];

const RECOVERY_COLUMNS = {
  services: [
    ["membershipPricePaise", "INTEGER NOT NULL DEFAULT 0"],
    ["membershipPriceRecorded", "INTEGER NOT NULL DEFAULT 0"]
  ],
  products: [
    ["legacyIssueQuantity", "REAL NOT NULL DEFAULT 0"],
    ["legacyIssueRecorded", "INTEGER NOT NULL DEFAULT 0"],
    ["sourceQrCode", "TEXT NOT NULL DEFAULT ''"],
    ["qrCode", "TEXT NOT NULL DEFAULT ''"]
  ],
  memberships: [
    ["soldByStaffId", "TEXT NOT NULL DEFAULT ''"],
    ["soldByStaffName", "TEXT NOT NULL DEFAULT ''"]
  ],
  sales: [
    ["recoveryDuplicateOf", "TEXT NOT NULL DEFAULT ''"],
    ["recoveryOriginalTotalPaise", "INTEGER NOT NULL DEFAULT 0"],
    ["recoveryVoidReason", "TEXT NOT NULL DEFAULT ''"]
  ],
  invoices: [
    ["recoveryDuplicateOf", "TEXT NOT NULL DEFAULT ''"],
    ["recoveryOriginalTotalPaise", "INTEGER NOT NULL DEFAULT 0"],
    ["recoveryVoidReason", "TEXT NOT NULL DEFAULT ''"]
  ],
  gift_cards: [
    ["branchId", "TEXT NOT NULL DEFAULT ''"],
    ["tenant_id", "TEXT NOT NULL DEFAULT ''"],
    ["branch_id", "TEXT NOT NULL DEFAULT ''"],
    ["code_hash", "TEXT NOT NULL DEFAULT ''"],
    ["display_code_last4", "TEXT NOT NULL DEFAULT ''"],
    ["customer_id", "TEXT NOT NULL DEFAULT ''"],
    ["purchaser_customer_id", "TEXT NOT NULL DEFAULT ''"],
    ["initial_value", "REAL NOT NULL DEFAULT 0"],
    ["initialValuePaise", "INTEGER NOT NULL DEFAULT 0"],
    ["balancePaise", "INTEGER NOT NULL DEFAULT 0"],
    ["currency", "TEXT NOT NULL DEFAULT 'INR'"],
    ["expiry_date", "TEXT NOT NULL DEFAULT ''"],
    ["created_invoice_id", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["originalSystem", "TEXT NOT NULL DEFAULT ''"],
    ["originalRecordId", "TEXT NOT NULL DEFAULT ''"],
    ["importedAt", "TEXT NOT NULL DEFAULT ''"],
    ["importBatchId", "TEXT NOT NULL DEFAULT ''"]
  ],
  gift_card_transactions: [
    ["branchId", "TEXT NOT NULL DEFAULT ''"],
    ["branch_id", "TEXT NOT NULL DEFAULT ''"],
    ["amountPaise", "INTEGER NOT NULL DEFAULT 0"],
    ["balanceAfterPaise", "INTEGER NOT NULL DEFAULT 0"],
    ["originalSystem", "TEXT NOT NULL DEFAULT ''"],
    ["originalRecordId", "TEXT NOT NULL DEFAULT ''"],
    ["importedAt", "TEXT NOT NULL DEFAULT ''"],
    ["importBatchId", "TEXT NOT NULL DEFAULT ''"]
  ],
  settings: [
    ["branchId", "TEXT NOT NULL DEFAULT ''"]
  ],
  migration_staging_rows: [
    ["branchId", "TEXT NOT NULL DEFAULT ''"]
  ]
};

function safeColumns(table) {
  try {
    return columnsFor(table);
  } catch {
    return [];
  }
}

function ensureColumn(table, columns, column, definition) {
  if (!columns.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function ensureRollbackIndex(table) {
  const columns = safeColumns(table);
  if (!columns.includes("importBatchId")) return;
  const tenantColumn = columns.includes("tenantId") ? "tenantId" : columns.includes("tenant_id") ? "tenant_id" : "";
  const fields = tenantColumn ? `${tenantColumn}, importBatchId` : "importBatchId";
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_migration_batch ON ${table} (${fields})`).run();
}

export function ensureMigrationTargetMetadataSchema() {
  if (ensured) return;
  for (const table of TARGET_TABLES) {
    const columns = safeColumns(table);
    if (!columns.length) continue;
    for (const [column, definition] of MIGRATION_COLUMNS) {
      ensureColumn(table, columns, column, definition);
      if (!columns.includes(column)) columns.push(column);
    }
    ensureRollbackIndex(table);
  }
  for (const [table, definitions] of Object.entries(RECOVERY_COLUMNS)) {
    const columns = safeColumns(table);
    if (!columns.length) continue;
    for (const [column, definition] of definitions) {
      ensureColumn(table, columns, column, definition);
      if (!columns.includes(column)) columns.push(column);
    }
  }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_gift_cards_recovery_source ON gift_cards (tenantId, branchId, originalRecordId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_products_qr_code ON products (tenantId, branchId, qrCode)").run();
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_communication_consents (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      sourceSystem TEXT NOT NULL DEFAULT '',
      sourceRecordId TEXT NOT NULL DEFAULT '',
      transactionalSms INTEGER NOT NULL DEFAULT 0,
      promotionalSms INTEGER NOT NULL DEFAULT 0,
      transactionalEmail INTEGER NOT NULL DEFAULT 0,
      promotionalEmail INTEGER NOT NULL DEFAULT 0,
      transactionalWhatsapp INTEGER NOT NULL DEFAULT 0,
      promotionalWhatsapp INTEGER NOT NULL DEFAULT 0,
      raw TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, branchId, sourceSystem, sourceRecordId)
    );
    CREATE INDEX IF NOT EXISTS idx_client_communication_consents_client
      ON client_communication_consents (tenantId, branchId, clientId);
  `);
  ensured = true;
}
