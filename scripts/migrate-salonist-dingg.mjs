import XLSX from "xlsx";
import { db } from "../server/db.js";
import { migrationService } from "../server/services/migration.service.js";

const TENANT_ID = "tenant_salonist";
const BRANCH_ID = "branch_363bdc6b-2";
const OWNER_ID = "tu_6abfbedb-a";
const shouldImport = process.argv.includes("--import");
const access = {
  tenantId: TENANT_ID,
  branchId: BRANCH_ID,
  branchIds: [BRANCH_ID],
  role: "owner",
  userId: OWNER_ID
};

const clean = (value) => String(value ?? "").trim();
const amount = (value) => {
  const parsed = Number(clean(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const integer = (value) => Math.round(amount(value));
const phoneKey = (value) => {
  const digits = clean(value).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const isoDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = clean(value);
  if (!text) return "";
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let [, first, second, year] = slash.map(Number);
    if (year < 100) year += 2000;
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};
const rowsFor = (workbook, sheetName) => XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
  defval: "",
  raw: true,
  blankrows: false
});
const sourceId = (sheet, rowNumber, preferred = "") => clean(preferred) || `${sheet}:${rowNumber}`;

const dingg = XLSX.readFile("DINGG DATA TO SALONIST.xlsx", { cellDates: true, cellFormula: false });
const salonist = XLSX.readFile("DINGG EXCEL.xlsx", { cellDates: true, cellFormula: false });

const clientByPhone = new Map();
for (const [index, row] of rowsFor(dingg, "clint ").entries()) {
  const phone = phoneKey(row.Mobile);
  if (phone.length < 7 || !clean(row.Name)) continue;
  const notes = [
    clean(row.Code) && `Legacy code: ${clean(row.Code)}`,
    clean(row.Member) && `Legacy member: ${clean(row.Member)}`,
    `Legacy amount: ${amount(row.Amount)}`,
    `Legacy visits: ${integer(row.Visit)}`,
    `Legacy no-shows: ${integer(row["No Show"])}`
  ].filter(Boolean).join(" | ");
  clientByPhone.set(phone, {
    originalRecordId: sourceId("clint", index + 2, row.Code),
    name: clean(row.Name),
    phone,
    email: clean(row.Email),
    gender: clean(row.Gender),
    birthday: isoDate(row.DOB),
    anniversary: isoDate(row.Anniversary),
    notes,
    totalSpend: amount(row.Amount),
    visitCount: integer(row.Visit),
    noShowCount: integer(row["No Show"]),
    lastVisitAt: isoDate(row["Last Visit"]),
    branchId: BRANCH_ID
  });
}
for (const [index, row] of rowsFor(salonist, "Customers").entries()) {
  const phone = phoneKey(row.Mobile);
  if (phone.length < 7 || !clean(row.Name) || clientByPhone.has(phone)) continue;
  clientByPhone.set(phone, {
    originalRecordId: sourceId("Customers", index + 2),
    name: clean(row.Name),
    phone,
    email: clean(row.Email),
    gender: clean(row.Gender),
    birthday: isoDate(row.DOB),
    anniversary: isoDate(row.Anniversary),
    notes: "Imported from DINGG Customers",
    branchId: BRANCH_ID
  });
}

const staff = rowsFor(salonist, "Staff").flatMap((row, index) => clean(row.Name) ? [{
  originalRecordId: sourceId("Staff", index + 2),
  name: clean(row.Name),
  phone: phoneKey(row.Mobile),
  email: clean(row.EmailID),
  role: clean(row.Title) || "Stylist",
  branchId: BRANCH_ID,
  status: "active"
}] : []);

const services = rowsFor(salonist, "Services").flatMap((row, index) => clean(row["Service Name"]) ? [{
  originalRecordId: sourceId("Services", index + 2),
  name: clean(row["Service Name"]),
  category: clean(row.Category) || "Imported",
  price: amount(row.Price),
  durationMinutes: integer(row.Timing) || 30,
  status: "active"
}] : []);

const seenProductSkus = new Set();
const productSource = rowsFor(salonist, "Products").flatMap((row, index) => {
  if (!clean(row["Product Name"])) return [];
  const rowNumber = index + 2;
  const sourceSku = clean(row["SKU NO "]) || `DINGG-${String(rowNumber).padStart(5, "0")}`;
  const sku = seenProductSkus.has(sourceSku.toLowerCase()) ? `${sourceSku}-${rowNumber}` : sourceSku;
  seenProductSkus.add(sku.toLowerCase());
  return [{ row, rowNumber, sku }];
});
const products = productSource.map(({ row, rowNumber, sku }) => ({
  originalRecordId: sourceId("Products", rowNumber, sku),
  name: clean(row["Product Name"]),
  sku,
  category: [clean(row.category), clean(row.Subcategory)].filter(Boolean).join(" / ") || "Imported",
  usageType: clean(row["Type ( R / C )  (i.e Retail or Consumable)"]).toUpperCase() === "C" ? "consumable" : "retail",
  supplier: clean(row["Brand Name"]),
  branchId: BRANCH_ID,
  stock: 0,
  unitCost: amount(row["Cost Price"]),
  price: amount(row.Price),
  unit: clean(row.Unit),
  packSize: amount(row.Measurment) || 1,
  packUnit: clean(row.Unit),
  status: "active"
}));
const inventory = productSource.flatMap(({ row, rowNumber, sku }) => {
  const quantity = amount(row["Current Stock"]);
  return quantity ? [{
    originalRecordId: sourceId("Products opening stock", rowNumber, sku),
    productId: sku,
    productName: clean(row["Product Name"]),
    sku,
    branchId: BRANCH_ID,
    type: "import_opening_stock",
    quantity,
    unitCost: amount(row["Cost Price"]),
    reason: "DINGG opening stock"
  }] : [];
});

const memberships = rowsFor(salonist, "Membership").flatMap((row, index) => clean(row["Client Name"]) ? [{
  originalRecordId: sourceId("Membership", index + 2),
  clientName: clean(row["Client Name"]),
  clientPhone: phoneKey(row.Mobile),
  planName: clean(row["MShip Type"]) || "Imported membership",
  price: amount(row["PRICE PAID "]),
  validityDate: isoDate(row["End date"]),
  branchId: BRANCH_ID,
  createdAt: isoDate(row["Start Date / Sell Date "])
}] : []);
memberships.push(...rowsFor(salonist, "Package Balance").flatMap((row, index) => clean(row.CustomerName) ? [{
  originalRecordId: sourceId("Package Balance", index + 2),
  clientName: clean(row.CustomerName),
  clientPhone: phoneKey(row.MobileNumber),
  planName: clean(row.Package) || clean(row.Service) || "Imported package",
  price: amount(row.amount),
  planCredits: integer(row["Origna Mnts"]),
  creditsRemaining: integer(row["Remaingi Balance"]),
  validityDate: isoDate(row.ExpiryDate),
  branchId: BRANCH_ID,
  createdAt: isoDate(row.InvoiceDate)
}] : []));
memberships.push(...rowsFor(salonist, "Prepaid  Voucher").flatMap((row, index) => clean(row["Client Name"]) ? [{
  originalRecordId: sourceId("Prepaid Voucher", index + 2),
  clientName: clean(row["Client Name"]),
  clientPhone: phoneKey(row["Client Number "]),
  planName: clean(row["Prepaid Name"]) || "Imported prepaid voucher",
  price: amount(row["Actual "]),
  planCredits: integer(row["Actual "]),
  creditsRemaining: integer(row["Current Balance"]),
  validityDate: isoDate(row["End Date"]),
  branchId: BRANCH_ID,
  createdAt: isoDate(row["Sale Date"])
}] : []));

const sales = rowsFor(salonist, "Service History").flatMap((row, index) => {
  const total = amount(row.Amount);
  if (!clean(row["Customer Name"]) || !clean(row["Service / product Name"]) || !total) return [];
  return [{
    originalRecordId: sourceId("Service History", index + 2),
    clientName: clean(row["Customer Name"]),
    clientPhone: phoneKey(row["Customer Mobile"]),
    staffName: clean(row["Stylist Name"]),
    branchId: BRANCH_ID,
    serviceName: clean(row["Service / product Name"]),
    lineItem: `${clean(row.Type) || "Item"}: ${clean(row["Service / product Name"])}`,
    subtotal: total,
    total,
    status: "completed",
    createdAt: isoDate(row.Date)
  }];
});

const invoices = [];
const payments = [];
const paymentColumns = [
  ["Cash", "cash"], ["Card", "card"], ["Online", "online"], ["Custom", "other"],
  ["Prepaid/voucher Redeemed", "wallet"], ["Package Redeemed", "membership"],
  ["Points Redeemed", "loyalty"], ["Gift Card Redeemed", "gift_card"], ["Advance Redeemed", "advance"]
];
for (const [index, row] of rowsFor(dingg, "invoice").entries()) {
  const invoiceNumber = clean(row["Invoice Number"]);
  const total = amount(row["Total Sale"]);
  if (!invoiceNumber || invoiceNumber === "Invoice Number" || clean(row.Location) === "Total" || !total) continue;
  const createdAt = isoDate(row.Date);
  invoices.push({
    originalRecordId: invoiceNumber,
    invoiceNumber,
    clientName: clean(row.Name) || "Walk-in Client",
    clientPhone: phoneKey(row.Mobile),
    branchId: BRANCH_ID,
    subtotal: amount(row.Net) || total,
    discount: amount(row.Discount),
    gstAmount: amount(row.Tax),
    total,
    balance: total,
    status: "unpaid",
    createdAt
  });
  let paid = 0;
  for (const [column, mode] of paymentColumns) {
    const paidAmount = amount(row[column]);
    if (!paidAmount) continue;
    paid += paidAmount;
    payments.push({ originalRecordId: `${invoiceNumber}:${mode}`, invoiceNumber, mode, amount: paidAmount, branchId: BRANCH_ID, createdAt });
  }
  if (clean(row["Invoice Status"]).toLowerCase() === "paid" && paid < total) {
    payments.push({ originalRecordId: `${invoiceNumber}:balance`, invoiceNumber, mode: "other", amount: total - paid, branchId: BRANCH_ID, createdAt });
  }
}
for (const [index, row] of rowsFor(dingg, "clint unpadie").entries()) {
  const invoiceNumber = clean(row["Invoice Number"]);
  const total = amount(row["Invoice Total"]);
  if (!invoiceNumber || !total) continue;
  const due = Math.max(0, amount(row["Amount Due"]));
  const createdAt = isoDate(row.Date);
  invoices.push({
    originalRecordId: invoiceNumber,
    invoiceNumber,
    clientName: clean(row["Customer Name"]) || "Walk-in Client",
    clientPhone: phoneKey(row["Customer Mobile"]),
    branchId: BRANCH_ID,
    subtotal: total,
    total,
    balance: total,
    status: "unpaid",
    createdAt
  });
  if (total > due) payments.push({
    originalRecordId: `${invoiceNumber}:legacy-paid`,
    invoiceNumber,
    mode: "other",
    amount: total - due,
    branchId: BRANCH_ID,
    createdAt
  });
}

const datasets = [
  ["clients", [...clientByPhone.values()]],
  ["staff", staff],
  ["services", services],
  ["products", products],
  ["inventory", inventory],
  ["memberships", memberships],
  ["sales", sales],
  ["invoices", invoices],
  ["payments", payments]
].filter(([, rows]) => rows.length);

function payloadFor(resource, rows) {
  const mapping = Object.fromEntries(Array.from(new Set(rows.flatMap((row) => Object.keys(row || {})))).map((key) => [key, key]));
  return {
    rows,
    resource,
    mapping,
    sourceSoftware: "dingg",
    fileName: `salonist-dingg-${resource}.xlsx`,
    branchId: BRANCH_ID,
    skipApprovalGate: true,
    allowPartialImport: false,
    migrationMode: true
  };
}

const tenant = db.prepare("SELECT id FROM tenants WHERE id = @tenantId").get({ tenantId: TENANT_ID });
const branch = db.prepare("SELECT id FROM branches WHERE id = @branchId AND tenantId = @tenantId").get({ branchId: BRANCH_ID, tenantId: TENANT_ID });
if (!tenant || !branch) throw new Error("Target tenant or branch does not exist");

const preflightWorkbook = XLSX.utils.book_new();
const preflightMapping = {};
for (const [resource, rows] of datasets) {
  XLSX.utils.book_append_sheet(preflightWorkbook, XLSX.utils.json_to_sheet(rows), resource);
  for (const key of Object.keys(rows[0] || {})) preflightMapping[key] = key;
}
const preflight = migrationService.dryRun({
  fileBase64: XLSX.write(preflightWorkbook, { bookType: "xlsx", type: "base64" }),
  fileName: "salonist-dingg-preflight.xlsx",
  sourceSoftware: "dingg",
  mapping: preflightMapping,
  branchId: BRANCH_ID
}, access);
const errors = Number(preflight.summary.errorRows || 0);
const warningReasons = Object.entries((preflight.allRows || preflight.rows)
  .filter((row) => row.status === "warning")
  .reduce((counts, row) => ({ ...counts, [row.message]: (counts[row.message] || 0) + 1 }), {}))
  .sort((left, right) => right[1] - left[1]);
console.log(JSON.stringify({ mode: shouldImport ? "pre-import" : "dry-run", errors, warningReasons, summary: preflight.summary }, null, 2));
if (errors) throw new Error(`Dry run found ${errors} blocking rows`);
if (!shouldImport) process.exit(0);

const completedJobs = [];
try {
  for (const [resource, rows] of datasets) {
    const result = migrationService.import(payloadFor(resource, rows), access);
    if (!result.alreadyImported) completedJobs.push(result.jobId);
    console.log(JSON.stringify({ resource, jobId: result.jobId, batchId: result.batchId, summary: result.summary }));
    if (Number(result.summary?.errorRows || 0)) throw new Error(`${resource} import completed with errors`);
  }
} catch (error) {
  for (const jobId of completedJobs.reverse()) migrationService.rollback(jobId, access, { reason: "Automatic rollback after Salonist migration failure" });
  throw error;
}
