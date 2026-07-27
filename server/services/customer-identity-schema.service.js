import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, tableHasColumn } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, "..", "db", "migrations", "20260727_customer_accounts.sql");

let ensured = false;

export function ensureCustomerIdentitySchema() {
  if (ensured) return;
  db.exec(readFileSync(migrationPath, "utf8"));
  ensureClientColumn("customerAccountId", "TEXT DEFAULT ''");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_clients_global_account ON clients(customerAccountId) WHERE customerAccountId != ''").run();
  console.log("[MIGRATION] customer_accounts + link_audit + link_flags tables ready");
  ensured = true;
}

function ensureClientColumn(column, definition) {
  if (!tableHasColumn("clients", column)) {
    db.prepare(`ALTER TABLE clients ADD COLUMN ${column} ${definition}`).run();
  }
}
