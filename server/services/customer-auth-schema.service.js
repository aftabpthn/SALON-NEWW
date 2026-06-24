import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, "..", "db", "migrations", "20260622_customer_auth_codes.sql");

let ensured = false;

export function ensureCustomerAuthSchema() {
  if (ensured) return;
  db.exec(readFileSync(migrationPath, "utf8"));
  ensured = true;
}
