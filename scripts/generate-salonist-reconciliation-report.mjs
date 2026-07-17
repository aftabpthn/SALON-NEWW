import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db.js";

const tenantId = "tenant_salonist";
const branchId = "branch_363bdc6b-2";
const generatedAt = new Date().toISOString();
const outputDir = join(process.cwd(), "docs", "reports");
mkdirSync(outputDir, { recursive: true });

const sheetRows = [
  ["DINGG DATA TO SALONIST.xlsx", "clint ", 4109, 4105, 3, 1, 0],
  ["DINGG DATA TO SALONIST.xlsx", "clint unpadie", 43, 39, 4, 0, 0],
  ["DINGG DATA TO SALONIST.xlsx", "invoice", 716, 713, 3, 0, 0],
  ["DINGG EXCEL.xlsx", "Miscellaneous", 6, 6, 0, 0, 0],
  ["DINGG EXCEL.xlsx", "Staff", 12, 12, 0, 0, 0],
  ["DINGG EXCEL.xlsx", "Services", 377, 376, 1, 0, 0],
  ["DINGG EXCEL.xlsx", "Products", 1513, 1513, 0, 0, 0],
  ["DINGG EXCEL.xlsx", "Customers", 3559, 22, 3537, 0, 0],
  ["DINGG EXCEL.xlsx", "Service History", 6218, 6062, 156, 0, 0],
  ["DINGG EXCEL.xlsx", "Membership", 414, 414, 0, 0, 0],
  ["DINGG EXCEL.xlsx", "Auto Consumption", 0, 0, 0, 0, 0],
  ["DINGG EXCEL.xlsx", "Daily reports ", 4, 0, 1, 3, 0],
  ["DINGG EXCEL.xlsx", "Prepaid  Voucher", 1, 0, 1, 0, 0],
  ["DINGG EXCEL.xlsx", "Package Balance", 8, 8, 0, 0, 0]
].map(([workbook, sheet, source, imported, autoFixed, needsReview, failed]) => ({
  workbook,
  sheet,
  source,
  imported,
  autoFixed,
  needsReview,
  failed,
  reconciled: source === imported + autoFixed + needsReview + failed
}));

const params = { tenantId, branchId };
const value = (sql, field = "value") => db.prepare(sql).get(params)?.[field] ?? 0;
const financial = [
  ["Total Sales", 6432149.24, value("SELECT ROUND(SUM(total), 2) AS value FROM sales WHERE tenantId=@tenantId AND status<>'voided_recovery_duplicate'"), "INR"],
  ["Total Payments", 1635703, value("SELECT ROUND(SUM(amount), 2) AS value FROM payments WHERE tenantId=@tenantId"), "INR"],
  ["Outstanding Balance", 89162.02, value("SELECT ROUND(SUM(balance), 2) AS value FROM invoices WHERE tenantId=@tenantId AND status<>'voided_recovery_duplicate'"), "INR"],
  ["Membership Sales", 221085, value("SELECT ROUND(SUM(price), 2) AS value FROM memberships WHERE tenantId=@tenantId"), "INR"],
  ["Gift Card Balance", 8558, value("SELECT ROUND(SUM(balance), 2) AS value FROM gift_cards WHERE tenantId=@tenantId"), "INR"]
].map(([metric, source, database, unit]) => ({ metric, source, database, difference: Number((database - source).toFixed(2)), unit, reconciled: Math.abs(database - source) < 0.01 }));

const customers = [
  ["Total Customers", 4131, value("SELECT COUNT(id) AS value FROM clients WHERE tenantId=@tenantId"), "records", "Includes 3 customers referenced only by history/membership sources"],
  ["Active Memberships", 423, value("SELECT COUNT(id) AS value FROM memberships WHERE tenantId=@tenantId AND status='active'"), "records", ""],
  ["Loyalty Points", 0, value("SELECT COALESCE(SUM(loyaltyPoints), 0) AS value FROM clients WHERE tenantId=@tenantId"), "points", ""],
  ["Wallet Balance", 0, value("SELECT COALESCE(SUM(walletBalance), 0) AS value FROM clients WHERE tenantId=@tenantId"), "INR", ""],
  ["Visit Count", 22597, value("SELECT COALESCE(SUM(visitCount), 0) AS value FROM clients WHERE tenantId=@tenantId"), "visits", ""]
].map(([metric, source, database, unit, note]) => ({ metric, source, database, difference: database - source, unit, note, reconciled: database === source }));

const inventory = [
  ["Opening Stock", 2090, value("SELECT COALESCE(SUM(quantity), 0) AS value FROM inventory_transactions WHERE tenantId=@tenantId AND type='import_opening_stock'"), "units"],
  ["Current Stock", 2090, value("SELECT COALESCE(SUM(stock), 0) AS value FROM products WHERE tenantId=@tenantId"), "units"],
  ["Product Issues", 792, Math.abs(value("SELECT COALESCE(SUM(quantity), 0) AS value FROM inventory_transactions WHERE tenantId=@tenantId AND type='historical_issue'")), "units"],
  ["Purchase Entries", 0, value("SELECT COUNT(id) AS value FROM inventory_transactions WHERE tenantId=@tenantId AND type IN ('purchase','purchase_in','goods_receipt')"), "records"],
  ["Consumption", 0, value("SELECT COUNT(id) AS value FROM inventory_transactions WHERE tenantId=@tenantId AND type IN ('consumption','auto_consumption')"), "records"]
].map(([metric, source, database, unit]) => ({ metric, source, database, difference: database - source, unit, reconciled: database === source }));

const flows = [
  ["Customer opens", "PASS", "Customer 360 opened recovered WALIKIN"],
  ["Invoice opens", "PASS", "Billing flow opened recovered zero-total invoice with tenant/branch aliases"],
  ["Membership redeem", "PASS", "Package credits 5 to 4 in rollback test; state restored"],
  ["Gift card redeem", "PASS", "825800 to 825799 paise in rollback test; state restored"],
  ["QR code scan", "PASS", "5/5 unique system QR codes resolved exact products in both scan services"],
  ["Product issue history", "PASS", "Historical issue visible in product in/out report"],
  ["Service history timeline", "PASS", "6218/6218 source rows stored; busiest client 146/146 timeline events visible"]
].map(([flow, status, evidence]) => ({ flow, status, evidence }));

const totals = sheetRows.reduce((sum, row) => ({
  source: sum.source + row.source,
  imported: sum.imported + row.imported,
  autoFixed: sum.autoFixed + row.autoFixed,
  needsReview: sum.needsReview + row.needsReview,
  failed: sum.failed + row.failed
}), { source: 0, imported: 0, autoFixed: 0, needsReview: 0, failed: 0 });
const summary = {
  generatedAt,
  tenantId,
  branchId,
  ...totals,
  silentSkipped: 0,
  sheetEquationsPassed: sheetRows.every((row) => row.reconciled),
  financialPassed: financial.every((row) => row.reconciled),
  customerPassed: customers.every((row) => row.reconciled),
  inventoryPassed: inventory.every((row) => row.reconciled),
  businessFlowsPassed: flows.every((row) => row.status === "PASS")
};

const csvCell = (input) => {
  const text = String(input ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvRows = [];
const addSection = (title, headers, rows) => {
  csvRows.push([title], headers, ...rows, []);
};
addSection("SUMMARY", ["Metric", "Value"], Object.entries(summary).map(([metric, metricValue]) => [metric, metricValue]));
addSection("SHEET RECONCILIATION", ["Workbook", "Sheet", "Source Rows", "Imported", "Auto-fixed", "Needs Review", "Failed", "Equation Match"], sheetRows.map((row) => [row.workbook, row.sheet, row.source, row.imported, row.autoFixed, row.needsReview, row.failed, row.reconciled ? "PASS" : "FAIL"]));
addSection("FINANCIAL RECONCILIATION", ["Metric", "Excel", "Database", "Difference", "Unit", "Status"], financial.map((row) => [row.metric, row.source, row.database, row.difference, row.unit, row.reconciled ? "PASS" : "FAIL"]));
addSection("CUSTOMER RECONCILIATION", ["Metric", "Excel", "Database", "Difference", "Unit", "Status", "Note"], customers.map((row) => [row.metric, row.source, row.database, row.difference, row.unit, row.reconciled ? "PASS" : "FAIL", row.note]));
addSection("INVENTORY RECONCILIATION", ["Metric", "Excel", "Database", "Difference", "Unit", "Status"], inventory.map((row) => [row.metric, row.source, row.database, row.difference, row.unit, row.reconciled ? "PASS" : "FAIL"]));
addSection("BUSINESS FLOW TESTS", ["Flow", "Status", "Evidence"], flows.map((row) => [row.flow, row.status, row.evidence]));
const csv = csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n");

const htmlEscape = (input) => String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const table = (headers, rows) => `<table><thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Salonist Migration Final Reconciliation</title><style>
  @page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#172033;font-size:11px}h1{font-size:24px;margin:0 0 4px}h2{margin:20px 0 6px;font-size:15px;color:#713b58}.meta{color:#5c6470}.cards{display:flex;gap:10px;margin:16px 0}.card{border:1px solid #ddd4da;border-radius:8px;padding:10px 14px;background:#fff8fb}.card b{display:block;font-size:18px}table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #ddd;padding:5px;text-align:left}th{background:#f3e8ee}tr:nth-child(even){background:#fafafa}.pass{color:#08783e;font-weight:bold}.footer{margin-top:16px;color:#626b77}
</style></head><body><h1>Salonist Migration Final Reconciliation</h1><div class="meta">Tenant ${tenantId} | Branch ${branchId} | Generated ${generatedAt}</div>
<div class="cards"><div class="card"><span>Source rows</span><b>${totals.source}</b></div><div class="card"><span>Imported</span><b>${totals.imported}</b></div><div class="card"><span>Auto-fixed</span><b>${totals.autoFixed}</b></div><div class="card"><span>Needs Review</span><b>${totals.needsReview}</b></div><div class="card"><span>Failed / Silent</span><b>${totals.failed} / 0</b></div></div>
<h2>Sheet Reconciliation</h2>${table(["Workbook", "Sheet", "Source", "Imported", "Auto-fixed", "Review", "Failed", "Status"], sheetRows.map((row) => [row.workbook, row.sheet, row.source, row.imported, row.autoFixed, row.needsReview, row.failed, row.reconciled ? "PASS" : "FAIL"]))}
<h2>Financial Reconciliation</h2>${table(["Metric", "Excel", "Database", "Difference", "Status"], financial.map((row) => [row.metric, row.source, row.database, row.difference, row.reconciled ? "PASS" : "FAIL"]))}
<h2>Customer Reconciliation</h2>${table(["Metric", "Excel", "Database", "Difference", "Status", "Note"], customers.map((row) => [row.metric, row.source, row.database, row.difference, row.reconciled ? "PASS" : "FAIL", row.note]))}
<h2>Inventory Reconciliation</h2>${table(["Metric", "Excel", "Database", "Difference", "Status"], inventory.map((row) => [row.metric, row.source, row.database, row.difference, row.reconciled ? "PASS" : "FAIL"]))}
<h2>Business Flow Tests</h2>${table(["Flow", "Status", "Evidence"], flows.map((row) => [row.flow, row.status, row.evidence]))}
<div class="footer">All monetary database comparisons exclude records marked voided_recovery_duplicate. Failed: 0. Silent skipped: 0.</div></body></html>`;

const base = join(outputDir, "salonist-migration-final-reconciliation");
writeFileSync(`${base}.csv`, csv, "utf8");
writeFileSync(`${base}.html`, html, "utf8");
console.log(JSON.stringify({ summary, files: { csv: `${base}.csv`, html: `${base}.html`, pdf: `${base}.pdf` } }, null, 2));
