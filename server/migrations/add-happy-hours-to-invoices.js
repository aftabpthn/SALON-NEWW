import { columnsFor, db } from "../db.js";

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

if (tableExists("invoices") && !columnsFor("invoices").includes("happyHourDiscountPaise")) {
  db.exec("ALTER TABLE invoices ADD COLUMN happyHourDiscountPaise INTEGER NOT NULL DEFAULT 0");
}
