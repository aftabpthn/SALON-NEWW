import * as XLSX from "xlsx";
import { createHash, randomUUID } from "node:crypto";
import { columnsFor, db, insertRow, listRows, updateRow } from "../db.js";
import { securityService } from "./security.service.js";
import { migrationUploadStore } from "./migration-upload-store.service.js";
import { balanceSheetService } from "./balance-sheet.service.js";
import { extractZipEntries, createZipArchive } from "../utils/zip-archive.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const makeIdLong = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '')}`;
const ANALYZER_FIX_VERSION = "2026-06-large-xref-invoicekey-1";
const UNMAPPED_BRANCH_PREFIX = "__unmapped_branch__:";
const BLOCKED_TIME_CLIENT_NAME = "Imported Blocked Time";
const SOURCE_BRANCH_ALIASES = [
  { branchId: "branch_hyd", names: ["0001 ho", "0001 0001", "head office", "ho"] },
  { branchId: "branch_blr", names: ["0002 baram", "baram", "baramati"] }
];

const SOURCE_ADAPTERS = {
  zenoti: { label: "Zenoti", type: "salon-pos", formats: ["xlsx", "csv", "zip"], status: "adapter-ready" },
  salonist: { label: "Salonist", type: "salon-pos", formats: ["xlsx", "csv", "zip"], status: "adapter-ready" },
  dingg: { label: "DINGG", type: "salon-pos", formats: ["xlsx", "csv", "zip"], status: "adapter-ready" },
  fresha: { label: "Fresha", type: "salon-pos", formats: ["xlsx", "csv", "zip"], status: "adapter-ready" },
  tally: { label: "Tally", type: "accounting", formats: ["xlsx", "csv", "zip"], status: "scaffold-ready" },
  busy: { label: "Busy", type: "accounting", formats: ["xlsx", "csv", "zip"], status: "scaffold-ready" },
  marg: { label: "Marg", type: "inventory-accounting", formats: ["xlsx", "csv", "zip"], status: "scaffold-ready" },
  excel: { label: "Generic Excel", type: "spreadsheet", formats: ["xlsx", "xls", "zip"], status: "adapter-ready" },
  csv: { label: "Generic CSV", type: "spreadsheet", formats: ["csv", "zip"], status: "adapter-ready" },
  manual: { label: "Manual records", type: "manual", formats: ["xlsx", "csv", "zip"], status: "adapter-ready" }
};

const RESOURCE_ORDER = [
  "clients",
  "staff",
  "services",
  "products",
  "vendors",
  "expenses",
  "memberships",
  "appointments",
  "sales",
  "invoices",
  "payments",
  "inventory"
];

const RESOURCE_ALIASES = {
  clients: ["client", "clients", "customer", "customers", "customer master", "client list"],
  staff: ["staff", "employee", "employees", "stylist", "therapist", "team"],
  services: ["service", "services", "menu", "service master"],
  products: ["product", "products", "items", "stock item", "inventory product"],
  inventory: ["inventory", "stock", "stock movement", "opening stock", "stock ledger"],
  vendors: ["vendor", "vendors", "supplier", "suppliers"],
  expenses: ["expense", "expenses", "purchase expense", "petty cash"],
  memberships: ["membership", "memberships", "package", "packages", "package balance"],
  appointments: ["appointment", "appointments", "booking", "bookings", "calendar"],
  sales: ["sale", "sales", "bill", "bills", "service history"],
  invoices: ["invoice", "invoices", "tax invoice"],
  payments: ["payment", "payments", "receipt", "receipts"]
};

const FIELD_ALIASES = {
  originalRecordId: ["id", "code", "external id", "record id", "old id", "legacy id", "customer id", "client id", "invoice id", "bill id", "payment id", "receipt id"],
  createdAt: ["created at", "created date", "date created", "created"],
  branchId: ["branch id", "outlet id", "location id"],
  branchName: ["branch", "branch name", "outlet", "location", "store"],
  name: ["name", "full name", "client name", "customer name", "staff name", "service name", "product name", "vendor name", "supplier name"],
  phone: ["phone", "mobile", "mobile number", "mobile no", "contact", "contact number"],
  email: ["email", "email id", "e-mail"],
  gender: ["gender", "sex"],
  birthday: ["birthday", "birth date", "dob", "date of birth"],
  anniversary: ["anniversary", "anniversary date"],
  notes: ["notes", "remark", "remarks", "comments", "description"],
  tags: ["tags", "tag", "segment"],
  role: ["role", "designation", "job title"],
  shift: ["shift", "working hours"],
  category: ["category", "department", "service category", "product category", "expense category"],
  price: ["price", "selling price", "sale price", "rate", "mrp"],
  durationMinutes: ["duration", "duration minutes", "service time", "time"],
  sku: ["sku", "barcode", "item code", "product code"],
  supplier: ["supplier", "vendor", "brand"],
  stock: ["stock", "quantity", "qty", "current stock", "available qty", "opening stock"],
  lowStockThreshold: ["low stock", "minimum stock", "min stock", "reorder level"],
  unitCost: ["cost", "unit cost", "purchase price", "buying price"],
  expiryDate: ["expiry", "expiry date", "valid till", "validity"],
  productId: ["product id", "item id"],
  productName: ["product", "product name", "item", "item name"],
  type: ["type", "movement type", "transaction type"],
  quantity: ["quantity", "qty", "units"],
  reason: ["reason", "narration"],
  contactName: ["contact person", "contact name"],
  gstin: ["gstin", "gst no", "gst number"],
  address: ["address"],
  vendor: ["vendor", "supplier", "paid to"],
  amount: ["amount", "paid amount", "net amount", "total"],
  taxAmount: ["tax", "gst", "tax amount", "gst amount"],
  paymentMode: ["payment mode", "mode", "paid by", "payment type", "tender", "tender type"],
  paidAt: ["paid at", "payment date", "date", "expense date"],
  clientId: ["client id", "customer id"],
  clientName: ["client", "customer", "client name", "customer name"],
  clientPhone: ["client phone", "customer phone", "mobile"],
  staffId: ["staff id", "employee id"],
  staffName: ["staff", "stylist", "therapist", "employee", "staff name"],
  serviceId: ["service id"],
  serviceName: ["service", "service name", "item name"],
  serviceIds: ["service ids", "services"],
  startAt: ["start", "start time", "appointment time", "booking time", "date time"],
  endAt: ["end", "end time"],
  status: ["status"],
  source: ["source", "booking source"],
  chair: ["chair", "room", "station"],
  planName: ["plan", "plan name", "membership", "membership name", "package name"],
  planCredits: ["credits", "total credits", "package credits"],
  creditsRemaining: ["remaining credits", "balance credits", "balance"],
  validityDate: ["validity", "valid till", "expiry", "expiry date"],
  autoRenew: ["auto renew", "auto-renew", "renewal"],
  invoiceNumber: ["invoice number", "invoice no", "bill no", "bill number", "receipt no", "receipt invoice no", "against invoice", "against bill"],
  saleId: ["sale id", "bill id"],
  invoiceId: ["invoice id", "legacy invoice id", "old invoice id", "source invoice id", "bill id", "legacy bill id"],
  subtotal: ["subtotal", "gross amount"],
  discount: ["discount"],
  gstAmount: ["gst", "gst amount", "tax amount"],
  total: ["total", "net total", "bill amount", "invoice total", "amount"],
  paid: ["paid", "paid amount"],
  balance: ["balance", "due", "outstanding"],
  reference: ["reference", "transaction id", "utr", "cheque no"],
  lineItem: ["item", "item name", "service", "product", "description"]
};

const RESOURCE_TEMPLATES = {
  clients: {
    table: "clients",
    required: ["name", "phone"],
    fields: ["originalRecordId", "name", "phone", "email", "gender", "birthday", "anniversary", "tags", "notes", "branchId", "branchName", "createdAt"]
  },
  staff: {
    table: "staff",
    required: ["name", "role", "branchId"],
    fields: ["originalRecordId", "name", "role", "phone", "email", "branchId", "branchName", "shift", "status", "createdAt"]
  },
  services: {
    table: "services",
    required: ["name", "category", "price", "durationMinutes"],
    fields: ["originalRecordId", "name", "category", "price", "durationMinutes", "gstRate", "status", "createdAt"]
  },
  products: {
    table: "products",
    required: ["name", "sku", "branchId"],
    fields: ["originalRecordId", "name", "sku", "category", "supplier", "branchId", "branchName", "stock", "lowStockThreshold", "expiryDate", "unitCost", "price", "gstRate", "createdAt"]
  },
  inventory: {
    table: "inventory_transactions",
    required: ["productId", "branchId", "type", "quantity"],
    fields: ["originalRecordId", "productId", "productName", "sku", "branchId", "branchName", "type", "quantity", "unitCost", "reason", "createdAt"]
  },
  vendors: {
    table: "suppliers",
    required: ["name"],
    fields: ["originalRecordId", "name", "contactName", "phone", "email", "gstin", "address", "status", "createdAt"]
  },
  expenses: {
    table: "finance_expenses",
    required: ["branchId", "category", "amount"],
    fields: ["originalRecordId", "branchId", "branchName", "category", "vendor", "amount", "taxAmount", "paymentMode", "paidAt", "notes", "createdAt"]
  },
  memberships: {
    table: "memberships",
    required: ["clientId", "planName"],
    fields: ["originalRecordId", "clientId", "clientName", "clientPhone", "planName", "price", "planCredits", "creditsRemaining", "validityDate", "autoRenew", "branchId", "branchName", "createdAt"]
  },
  appointments: {
    table: "appointments",
    required: ["clientId", "staffId", "branchId", "startAt"],
    fields: ["originalRecordId", "clientId", "clientName", "clientPhone", "staffId", "staffName", "serviceId", "serviceIds", "serviceName", "branchId", "branchName", "startAt", "endAt", "status", "source", "chair", "notes", "createdAt"]
  },
  sales: {
    table: "sales",
    required: ["clientId", "branchId", "total"],
    fields: ["originalRecordId", "clientId", "clientName", "clientPhone", "staffId", "staffName", "branchId", "branchName", "serviceName", "lineItem", "subtotal", "discount", "gstAmount", "total", "paymentMode", "status", "createdAt"]
  },
  invoices: {
    table: "invoices",
    required: ["invoiceNumber", "clientId", "total"],
    fields: ["originalRecordId", "saleId", "invoiceNumber", "clientId", "clientName", "clientPhone", "staffId", "staffName", "branchId", "branchName", "subtotal", "discount", "gstAmount", "total", "paid", "balance", "paymentMode", "status", "createdAt"]
  },
  payments: {
    table: "payments",
    required: ["invoiceId", "mode", "amount"],
    fields: ["invoiceId", "invoiceNumber", "originalRecordId", "mode", "paymentMode", "amount", "reference", "branchId", "branchName", "createdAt"]
  }
};

const MAX_IMPORT_ROWS = 50000;
const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;
const VALID_MIGRATION_TABLES = new Set([
  ...Object.values(RESOURCE_TEMPLATES).map((t) => t.table),
  "migration_large_jobs", "migration_file_chunks", "migration_reconciliation_snapshots", "migration_id_map",
  "migration_mappings", "migration_jobs", "migration_import_batches", "migration_row_results", "migration_audit_logs"
]);
const MIGRATION_ADMIN_TABLES = new Set([
  "migration_large_jobs", "migration_file_chunks", "migration_reconciliation_snapshots", "migration_id_map",
  "migration_mappings", "migration_jobs", "migration_import_batches", "migration_row_results", "migration_audit_logs"
]);
const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function assertValidTable(table, label) {
  if (!VALID_MIGRATION_TABLES.has(table)) {
    throw new Error(`Invalid table ${label || "name"}: ${table}`);
  }
}
function assertValidMigrationAdminTable(table, label) {
  if (!MIGRATION_ADMIN_TABLES.has(table)) {
    throw new Error(`Invalid admin table ${label || "name"}: ${table}`);
  }
}
function assertValidColumnNames(columns) {
  for (const col of columns) {
    if (!SAFE_IDENTIFIER_RE.test(col)) {
      throw new Error(`Invalid column name: ${col}`);
    }
  }
}

function assertImportPayloadLimits(payload, parsed) {
  const totalRows = Array.isArray(payload.rows) ? payload.rows.length
    : (parsed && Array.isArray(parsed.sheets) ? parsed.sheets.reduce((sum, s) => sum + (Array.isArray(s.rows) ? s.rows.length : 0), 0) : 0);
  if (totalRows > MAX_IMPORT_ROWS) {
    throw badRequest(`Import payload exceeds maximum row count of ${MAX_IMPORT_ROWS}. Received ${totalRows} rows. Large ZIP/XLSX imports are not supported in normal import mode. Please use Large Import Mode with CSV chunk upload.`);
  }
  if (payload.fileBase64) {
    const raw = String(payload.fileBase64).replace(/^data:[^;]+;base64,/, "");
    const decodedBytes = Buffer.from(raw, "base64").length;
    if (decodedBytes > MAX_IMPORT_FILE_BYTES) {
      throw badRequest(`Import file exceeds maximum size of ${Math.round(MAX_IMPORT_FILE_BYTES / 1024 / 1024)}MB. Received ${Math.round(decodedBytes / 1024 / 1024)}MB.`);
    }
  }
}

export const migrationService = {
  analyzerVersion() {
    return { analyzerFixVersion: ANALYZER_FIX_VERSION, ts: now() };
  },
  adapters() {
    return SOURCE_ADAPTERS;
  },

  templates(resource = "") {
    if (resource) return templateFor(resource);
    return Object.fromEntries(Object.keys(RESOURCE_TEMPLATES).map((key) => [key, templateFor(key)]));
  },
  uploadSource(payload, access) {
    return storeMigrationUpload(migrationUploadStore.store(payload, access), access);
  },

  uploadSourceBuffer(payload, access) {
    return storeMigrationUpload(migrationUploadStore.storeBuffer(payload, access), access);
  },

  createUploadSession(payload, access) {
    const session = migrationUploadStore.createSession(payload, access);
    auditMigration("migration.upload_session_created", {
      sessionId: session.sessionId,
      fileName: session.fileName,
      sizeBytes: session.sizeBytes,
      totalParts: session.totalParts
    }, access);
    return session;
  },

  uploadSessionPart(sessionId, partNumber, payload, access) {
    return migrationUploadStore.storeSessionPart(sessionId, partNumber, payload, access);
  },

  completeUploadSession(sessionId, payload, access) {
    const upload = migrationUploadStore.completeSession(sessionId, payload, access);
    return storeMigrationUpload(upload, access);
  },

  uploadSessions(query, access) {
    return migrationUploadStore.sessions(query || {}, access);
  },

  uploadSession(sessionId, access) {
    return migrationUploadStore.session(sessionId, access);
  },

  commandCenter(payload, access) {
    const preview = previewPayload(payload, access, { persist: false, dryRun: true });
    const report = buildMigrationCommandCenter(preview, payload, access);
    auditMigration("migration.command_center_previewed", {
      fileName: report.fileName,
      totalRows: report.totals.totalRows,
      conflicts: report.conflicts.total
    }, access);
    return report;
  },

  proofPack(payload, access) {
    return buildMigrationProofPack(payload || {}, access);
  },

  normalizeSource(payload, access) {
    const normalized = normalizeSourcePackage(payload, access);
    auditMigration("migration.source_normalized", {
      sourceFileName: normalized.sourceFileName,
      outputFileName: normalized.fileName,
      fileCount: normalized.summary.fileCount,
      totalRows: normalized.summary.totalRows
    }, access);
    return normalized;
  },

  mappings(access) {
    return db
      .prepare("SELECT * FROM migration_mappings WHERE tenantId = ? ORDER BY updatedAt DESC")
      .all(access.tenantId)
      .map((row) => deserializeJson(row, ["mapping", "unmatchedColumns", "requiredFields"]));
  },

  saveMapping(payload, access) {
    const resource = canonicalResource(payload.resource || "");
    if (!resource) throw badRequest("Valid resource is required to save an import mapping.");
    return insertMigrationRow("migration_mappings", {
      tenantId: access.tenantId,
      sourceSoftware: sourceKey(payload.sourceSoftware),
      resource,
      name: payload.name || `${SOURCE_ADAPTERS[sourceKey(payload.sourceSoftware)].label} ${resource}`,
      mapping: payload.mapping || {},
      unmatchedColumns: payload.unmatchedColumns || [],
      requiredFields: RESOURCE_TEMPLATES[resource].required
    });
  },

  suggestMapping(payload, access) {
    const resource = canonicalResource(payload.resource || "");
    if (!resource) throw badRequest("Valid resource is required to suggest a field mapping.");
    const columns = Array.isArray(payload.columns) ? payload.columns.filter(Boolean) : [];
    if (!columns.length) throw badRequest("At least one source column is required.");
    return suggestColumnMappings(columns, resource);
  },

  reconcile(payload, access) {
    const preview = previewPayload(payload, access, { persist: false, dryRun: true });
    const expected = payload.expected || {};
    const actualCounts = {};
    for (const [resource, bucket] of Object.entries(preview.summary.byResource || {})) {
      actualCounts[resource] = bucket.total;
    }
    const moneyResources = new Set(["invoices", "sales", "payments"]);
    let actualRevenue = 0;
    for (const row of preview.allRows || []) {
      if (!moneyResources.has(row.resource)) continue;
      const f = row.fields || {};
      const value = Number(f.total ?? f.amount ?? f.paid ?? 0);
      if (Number.isFinite(value)) actualRevenue += value;
    }
    const resourceLabels = {
      clients: "Clients", staff: "Staff", services: "Services", products: "Inventory",
      appointments: "Appointments", invoices: "Invoices", sales: "Sales", payments: "Payments",
      memberships: "Memberships", suppliers: "Suppliers", expenses: "Expenses"
    };
    const lines = [];
    const pushLine = (label, exp, act) => {
      const expN = Number(exp);
      const hasExpected = exp !== undefined && exp !== null && exp !== "" && Number.isFinite(expN);
      const difference = hasExpected ? act - expN : null;
      lines.push({
        metric: label,
        expected: hasExpected ? expN : null,
        actual: act,
        difference,
        match: hasExpected ? difference === 0 : null,
        status: !hasExpected ? "info" : difference === 0 ? "match" : "mismatch"
      });
    };
    const countResources = new Set([
      ...Object.keys(actualCounts),
      ...Object.keys(expected).filter((k) => k !== "revenue" && k !== "revenuePaise")
    ]);
    for (const resource of countResources) {
      pushLine(resourceLabels[resource] || resource, expected[resource], actualCounts[resource] || 0);
    }
    pushLine("Revenue (sum of source totals)", expected.revenuePaise ?? expected.revenue, actualRevenue);
    const mismatchCount = lines.filter((l) => l.status === "mismatch").length;
    return {
      fileName: preview.fileName,
      sourceSoftware: preview.sourceSoftware,
      matched: mismatchCount === 0,
      mismatchCount,
      totals: {
        totalRows: preview.summary.totalRows,
        validRows: preview.summary.validRows,
        errorRows: preview.summary.errorRows,
        duplicateRows: preview.summary.duplicateRows
      },
      lines
    };
  },

  createLargeJob(payload, access) {
    const sourceSoftware = sourceKey(payload.sourceSoftware);
    const resource = canonicalResource(payload.resource || "") || "auto";
    const chunkSize = Math.max(100, Math.min(50000, integer(payload.chunkSize, 5000)));
    const id = cleanText(payload.id) || makeId("mlg");
    insertDirectRow("migration_large_jobs", {
      id,
      tenantId: access.tenantId,
      branchId: cleanText(payload.branchId || access.branchId || ""),
      sourceSoftware,
      resource,
      fileName: cleanText(payload.fileName || "large-migration"),
      fileSizeBytes: integer(payload.fileSizeBytes, 0),
      status: "draft",
      workerId: "",
      lockedAt: "",
      heartbeatAt: "",
      totalRows: integer(payload.totalRows, 0),
      chunkSize,
      mapping: payload.mapping || {},
      settings: importSettings({ ...payload, sourceSoftware }, access),
      summary: { totalRows: integer(payload.totalRows, 0), chunkSize, resource, sourceSoftware },
      resumeToken: `job:${id}:chunk:0`,
      createdBy: access.userId || "system"
    });
    auditMigration("migration.large_job.created", { jobId: id, resource, sourceSoftware, chunkSize }, access);
    return largeMigrationJob(id, access);
  },

  pauseLargeJob(jobId, payload, access) {
    requireLargeMigrationJob(jobId, access);
    const reason = cleanText(payload.reason || "operator pause");
    updateDirectRow("migration_large_jobs", jobId, {
      status: "paused",
      workerId: "",
      lockedAt: "",
      heartbeatAt: "",
      failureReason: reason,
      resumeToken: `job:${jobId}:paused:${now()}`
    }, access);
    auditMigration("migration.large_job.paused", { jobId, reason }, access);
    return largeMigrationJob(jobId, access);
  },

  cancelLargeJob(jobId, payload, access) {
    requireLargeMigrationJob(jobId, access);
    const reason = cleanText(payload.reason || "operator cancel");
    const cancelable = cancelLargeJobChunks(jobId, access);
    updateDirectRow("migration_large_jobs", jobId, {
      status: "cancelled",
      workerId: "",
      lockedAt: "",
      heartbeatAt: "",
      failureReason: reason,
      completedAt: now(),
      resumeToken: `job:${jobId}:cancelled:${now()}`
    }, access);
    auditMigration("migration.large_job.cancelled", { jobId, reason, chunks: cancelable }, access);
    return largeMigrationJob(jobId, access);
  },

  discardLargeJob(jobId, access) {
    const job = requireLargeMigrationJob(jobId, access);
    const scope = { tenantId: access.tenantId, jobId: job.id };
    const removed = withBusyRetry(() => db.transaction(() => {
      const staging = db.prepare("DELETE FROM migration_staging_rows WHERE tenantId = @tenantId AND jobId = @jobId").run(scope).changes || 0;
      const chunks = db.prepare("DELETE FROM migration_file_chunks WHERE tenantId = @tenantId AND jobId = @jobId").run(scope).changes || 0;
      const rowResults = db.prepare("DELETE FROM migration_row_results WHERE tenantId = @tenantId AND jobId = @jobId").run(scope).changes || 0;
      const batches = db.prepare("DELETE FROM migration_import_batches WHERE tenantId = @tenantId AND jobId = @jobId").run(scope).changes || 0;
      db.prepare("DELETE FROM migration_large_jobs WHERE tenantId = @tenantId AND id = @jobId").run(scope);
      return { staging, chunks, rowResults, batches };
    })());
    auditMigration("migration.large_job.discarded", { jobId: job.id, ...removed }, access);
    return { ok: true, jobId: job.id, discarded: removed, message: "Failed large import job cleared. Re-upload to start fresh." };
  },

  retryFailedLargeJobChunks(jobId, payload, access) {
    const job = requireLargeMigrationJob(jobId, access);
    const reset = resetFailedLargeJobChunks(jobId, access, payload);
    const settings = { ...parseJsonField(job.settings, {}), worker: workerSettings(payload) };
    recomputeLargeJobTotals(jobId, access);
    updateDirectRow("migration_large_jobs", jobId, {
      status: reset ? "queued" : "paused",
      workerId: "",
      lockedAt: "",
      heartbeatAt: "",
      settings,
      failureReason: reset ? "" : "No failed chunks to retry",
      failedAt: "",
      resumeToken: `job:${jobId}:retry:${now()}`
    }, access);
    auditMigration("migration.large_job.retry_failed", { jobId, reset }, access);
    return largeMigrationJob(jobId, access);
  },
  queueLargeJob(jobId, payload, access) {
    const job = requireLargeMigrationJob(jobId, access);
    const settings = { ...parseJsonField(job.settings, {}), worker: workerSettings(payload) };
    updateDirectRow("migration_large_jobs", jobId, {
      status: "queued",
      workerId: "",
      lockedAt: "",
      heartbeatAt: "",
      settings,
      failureReason: "",
      failedAt: "",
      resumeToken: `job:${jobId}:queued:${now()}`
    }, access);
    auditMigration("migration.large_job.queued", { jobId, settings: settings.worker }, access);
    return largeMigrationJob(jobId, access);
  },

  processQueuedLargeJobs(payload = {}, access = {}) {
    return processQueuedLargeMigrationJobs(payload, access);
  },

  parseCsvText(csvText) {
    return parseCsvChunkRows({ csvText });
  },

  analyzeChunkRows(jobId, chunkNumber, payload, access) {
    return this.analyzeLargeJobChunk(jobId, chunkNumber, payload, access);
  },
  startLargeJob(jobId, payload, access) {
    requireLargeMigrationJob(jobId, access);
    assertLargeJobReadyForImport(jobId, payload, access);
    updateDirectRow("migration_large_jobs", jobId, { status: "processing", workerId: "", lockedAt: "", heartbeatAt: "", startedAt: now(), failureReason: "" }, access);
    const result = processLargeJobStagedChunks(jobId, payload, access);
    auditMigration("migration.large_job.started", { jobId, result }, access);
    return result;
  },

  resumeLargeJob(jobId, payload, access) {
    requireLargeMigrationJob(jobId, access);
    assertLargeJobReadyForImport(jobId, payload, access);
    updateDirectRow("migration_large_jobs", jobId, { status: "processing", workerId: "", lockedAt: "", heartbeatAt: "", failureReason: "" }, access);
    const result = processLargeJobStagedChunks(jobId, payload, access);
    auditMigration("migration.large_job.resumed", { jobId, result }, access);
    return result;
  },
  largeJob(id, access) {
    return largeMigrationJob(id, access);
  },

  reconcileLargeJob(jobId, payload = {}, access) {
    const snapshot = createLargeJobReconciliation(jobId, payload, access);
    auditMigration("migration.large_job.reconciled", { jobId, snapshotId: snapshot.id, status: snapshot.status, differences: snapshot.differences.length }, access);
    return { job: largeMigrationJob(jobId, access), snapshot };
  },

  registerLargeJobChunk(jobId, payload, access) {
    const job = requireLargeMigrationJob(jobId, access);
    const chunkNumber = Math.max(1, integer(payload.chunkNumber, integer(payload.index, 0)));
    const totalRows = integer(payload.totalRows, Array.isArray(payload.rows) ? payload.rows.length : 0);
    const existing = db.prepare("SELECT * FROM migration_file_chunks WHERE tenantId = @tenantId AND jobId = @jobId AND chunkNumber = @chunkNumber").get({ tenantId: access.tenantId, jobId, chunkNumber });
    const incomingChecksum = cleanText(payload.checksum || "");
    if (existing) {
      const existingChunk = deserializeDirectRow(existing);
      assertLargeChunkMutable(existingChunk, "registered again");
      assertLargeChunkChecksum(existingChunk, incomingChecksum, "registered again");
    }
    const id = existing?.id || cleanText(payload.id) || makeId("mchunk");
    const row = {
      id,
      tenantId: access.tenantId,
      jobId,
      chunkNumber,
      sourceSheet: cleanText(payload.sourceSheet || payload.sheetName || ""),
      rowStart: integer(payload.rowStart, 0),
      rowEnd: integer(payload.rowEnd, 0),
      status: existing?.status || "pending",
      totalRows,
      checksum: incomingChecksum || cleanText(existing?.checksum || ""),
      payloadRef: cleanText(payload.payloadRef || ""),
      summary: payload.summary || { totalRows }
    };
    if (existing) updateDirectRow("migration_file_chunks", id, row, access);
    else insertDirectRow("migration_file_chunks", row);
    recomputeLargeJobTotals(job.id, access);
    auditMigration("migration.large_job.chunk_registered", { jobId, chunkId: id, chunkNumber, totalRows }, access);
    return largeMigrationJob(jobId, access);
  },

  stageLargeJobCsvChunk(jobId, chunkNumber, payload, access) {
    const rows = parseCsvChunkRows(payload);
    if (!rows.length) throw badRequest("CSV chunk has no data rows.");
    const checksum = verifiedCsvChunkChecksum(payload);
    this.registerLargeJobChunk(jobId, {
      chunkNumber,
      totalRows: rows.length,
      rowStart: integer(payload.rowStart, 0),
      rowEnd: integer(payload.rowEnd, integer(payload.rowStart, 0) + rows.length - 1),
      sourceSheet: cleanText(payload.sourceSheet || "csv"),
      checksum
    }, access);
    return this.analyzeLargeJobChunk(jobId, chunkNumber, {
      ...payload,
      rows,
      checksum,
      sourceSheet: cleanText(payload.sourceSheet || "csv")
    }, access);
  },
  analyzeLargeJobChunk(jobId, chunkNumber, payload, access) {
    const job = requireLargeMigrationJob(jobId, access);
    const chunk = requireLargeMigrationChunk(jobId, chunkNumber, access);
    assertLargeChunkMutable(chunk, "analyzed again");
    assertLargeChunkChecksum(chunk, cleanText(payload.checksum || ""), "analyzed again");
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw badRequest("rows are required for chunk analysis.");
    const preview = previewPayload(largeChunkPayload(job, payload, rows), access, { persist: false, dryRun: true, jobId: job.id });
    replaceStagingRows(job.id, chunk.id, chunk.chunkNumber, preview, access, payload.duplicateDecisions || {});
    updateDirectRow("migration_file_chunks", chunk.id, {
      status: preview.summary.errorRows ? "analyzed_with_errors" : "analyzed",
      processedRows: preview.summary.totalRows,
      validRows: preview.summary.validRows,
      warningRows: preview.summary.warningRows,
      errorRows: preview.summary.errorRows,
      summary: preview.summary,
      completedAt: now(),
      failureReason: ""
    }, access);
    recomputeLargeJobTotals(job.id, access);
    auditMigration("migration.large_job.chunk_analyzed", { jobId, chunkId: chunk.id, chunkNumber: chunk.chunkNumber, summary: preview.summary }, access);
    return { job: largeMigrationJob(jobId, access), chunk: directChunk(chunk.id, access), summary: preview.summary, rows: preview.rows };
  },

  importLargeJobChunk(jobId, chunkNumber, payload, access) {
    const job = requireLargeMigrationJob(jobId, access);
    const chunk = requireLargeMigrationChunk(jobId, chunkNumber, access);
    assertLargeChunkImportable(chunk);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw badRequest("rows are required for chunk import.");
    const preview = previewPayload(largeChunkPayload(job, payload, rows), access, { persist: false, dryRun: false, jobId: job.id });
    const allowPartialImport = payload.allowPartialImport === true;
    const gate = migrationApprovalGate(access, preview.summary, approvalIdentityForJob(job, preview.summary));
    if (!gate.approved && payload.skipApprovalGate !== true) {
      throw badRequest("Owner approval required for this exact migration job.");
    }
    if (Number(preview.summary.errorRows || 0) > 0 && !allowPartialImport && payload.skipApprovalGate !== true) {
      throw badRequest(`Final chunk import blocked: ${preview.summary.errorRows} critical row(s) present. Enable partial import to skip invalid rows or fix the source.`);
    }
    const batchId = makeId("batch");
    const sourceSoftware = job.sourceSoftware || sourceKey(payload.sourceSoftware);
    insertMigrationRow("migration_import_batches", {
      id: batchId,
      tenantId: access.tenantId,
      jobId,
      sourceSoftware,
      resource: job.resource || payload.resource || "auto",
      branchId: job.branchId || access.branchId || "",
      status: "importing",
      summary: preview.summary,
      filters: { branchId: job.branchId || access.branchId || "", resource: job.resource || payload.resource || "auto", chunkNumber: chunk.chunkNumber }
    });
    const importTx = db.transaction(() => importPreviewRows(preview, {
      access,
      batchId,
      jobId,
      sourceSoftware,
      migrationMode: payload.migrationMode !== false,
      duplicateDecisions: payload.duplicateDecisions || {},
      allowPartialImport
    }));
    const result = withBusyRetry(() => importTx());
    const summary = { ...preview.summary, ...result, completedAt: now(), chunkNumber: chunk.chunkNumber };
    updateDirectRow("migration_file_chunks", chunk.id, {
      status: result.errorRows ? "imported_with_errors" : "imported",
      processedRows: preview.summary.totalRows,
      validRows: preview.summary.validRows,
      warningRows: result.warningRows,
      errorRows: result.errorRows,
      importedRows: result.importedRows,
      skippedRows: result.skippedRows,
      summary,
      completedAt: now(),
      failureReason: ""
    }, access);
    updateMigrationRow("migration_import_batches", batchId, { status: result.errorRows ? "completed_with_errors" : "completed", summary }, { tenantId: access.tenantId });
    recomputeLargeJobTotals(job.id, access);
    auditMigration("migration.large_job.chunk_imported", { jobId, batchId, chunkId: chunk.id, chunkNumber: chunk.chunkNumber, summary }, access);
    return { job: largeMigrationJob(jobId, access), batchId, chunk: directChunk(chunk.id, access), summary };
  },
  importLargeJobStagedChunk(jobId, chunkNumber, payload, access) {
    return importStagedLargeJobChunk(jobId, chunkNumber, payload, access);
  },
  submitApproval(payload, access) {
    ensureMigrationApprovalSchema();
    const id = makeId("mapr");
    const ts = now();
    const identity = approvalIdentityFromSubmission(payload);
    const submittedSummary = payload.summary?.summary || payload.summary || {};
    const errorCount = integer(payload.errorCount ?? submittedSummary.errorRows ?? submittedSummary.errorCount, 0);
    const warningCount = integer(payload.warningCount ?? submittedSummary.warningRows ?? submittedSummary.warningCount, 0);
    const validRows = integer(payload.validRows ?? submittedSummary.validRows, 0);
    const importableRows = integer(payload.importableRows ?? validRows, validRows);
    const record = {
      id,
      tenantId: access.tenantId,
      branchId: payload.branchId || access.branchId || "",
      jobId: identity.jobId || "",
      resource: identity.resource || "auto",
      sourceSoftware: identity.sourceSoftware || "",
      fileName: identity.fileName || "",
      sourceFileHash: identity.sourceFileHash || "",
      totalRows: identity.totalRows || 0,
      errorCount,
      warningCount,
      validRows,
      importableRows,
      status: "pending",
      note: cleanText(payload.note),
      summaryJson: JSON.stringify(payload.summary || {}),
      submittedBy: access.userId || "system",
      submittedAt: ts,
      reviewedBy: "",
      reviewedAt: "",
      createdAt: ts,
      updatedAt: ts
    };
    db.prepare(
      `INSERT INTO migration_approvals
        (id, tenantId, branchId, jobId, resource, sourceSoftware, fileName, sourceFileHash, totalRows, errorCount, warningCount, validRows, importableRows, status, note, summaryJson, submittedBy, submittedAt, reviewedBy, reviewedAt, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @jobId, @resource, @sourceSoftware, @fileName, @sourceFileHash, @totalRows, @errorCount, @warningCount, @validRows, @importableRows, @status, @note, @summaryJson, @submittedBy, @submittedAt, @reviewedBy, @reviewedAt, @createdAt, @updatedAt)`
    ).run(record);
    auditMigration("migration.approval.submitted", { jobId: record.jobId, approvalId: id, fileName: record.fileName, sourceFileHash: record.sourceFileHash, totalRows: record.totalRows, errorCount, warningCount, validRows, importableRows }, access);
    return deserializeApproval(record);
  },

  approvals(query, access) {
    ensureMigrationApprovalSchema();
    const status = cleanText(query?.status);
    const rows = status
      ? db.prepare("SELECT * FROM migration_approvals WHERE tenantId = ? AND status = ? ORDER BY createdAt DESC LIMIT 100").all(access.tenantId, status)
      : db.prepare("SELECT * FROM migration_approvals WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 100").all(access.tenantId);
    return rows.map(deserializeApproval);
  },

  decideApproval(id, payload, access) {
    ensureMigrationApprovalSchema();
    const role = String(access.role || "").toLowerCase();
    if (!["owner", "manager", "accountant"].includes(role)) {
      throw forbidden("Only an owner or manager can approve or reject a migration.");
    }
    const decision = String(payload.decision || "").toLowerCase();
    if (!["approved", "rejected"].includes(decision)) {
      throw badRequest("decision must be 'approved' or 'rejected'.");
    }
    const existing = db.prepare("SELECT * FROM migration_approvals WHERE id = ? AND tenantId = ?").get(id, access.tenantId);
    if (!existing) throw badRequest("Migration approval request not found.");
    if (existing.status !== "pending") throw badRequest(`This request is already ${existing.status}.`);
    const ts = now();
    db.prepare(
      `UPDATE migration_approvals
         SET status = @status, note = @note, reviewedBy = @reviewedBy, reviewedAt = @reviewedAt, updatedAt = @updatedAt
       WHERE id = @id AND tenantId = @tenantId`
    ).run({
      id,
      tenantId: access.tenantId,
      status: decision,
      note: cleanText(payload.note) || existing.note,
      reviewedBy: access.userId || "system",
      reviewedAt: ts,
      updatedAt: ts
    });
    auditMigration(`migration.approval.${decision}`, { jobId: existing.jobId, approvalId: id }, access);
    return deserializeApproval({ ...existing, status: decision, reviewedBy: access.userId || "system", reviewedAt: ts, updatedAt: ts });
  },

  jobs(access) {
    return db
      .prepare("SELECT * FROM migration_jobs WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 50")
      .all(access.tenantId)
      .map((row) => deserializeJson(row, ["summary", "mapping", "settings"]));
  },

  job(id, access) {
    const job = db.prepare("SELECT * FROM migration_jobs WHERE id = ? AND tenantId = ?").get(id, access.tenantId);
    if (!job) return null;
    const rows = db
      .prepare("SELECT * FROM migration_row_results WHERE jobId = ? AND tenantId = ? ORDER BY sourceSheet, sourceRowNumber, createdAt LIMIT 1000")
      .all(id, access.tenantId)
      .map((row) => deserializeJson(row, ["payload", "raw", "errors", "warnings"]));
    return { ...deserializeJson(job, ["summary", "mapping", "settings"]), rows };
  },

  jobRecovery(id, access) {
    return migrationJobRecovery(id, access);
  },

  onboarding(access) {
    const jobs = this.jobs(access);
    const lastJob = jobs[0] || null;
    const errors = jobs.reduce((total, job) => total + Number(job.errorRows || 0), 0);
    const importedRecords = jobs.reduce((total, job) => total + Number(job.importedRows || 0), 0);
    const rollbackHistory = jobs.filter((job) => job.status === "rolled_back").length;
    const clientTotals = liveClientTotals(access);
    return {
      uploadStatus: lastJob ? lastJob.status : "not_started",
      migrationProgress: lastJob ? progressFor(lastJob) : 0,
      errorsCount: errors,
      importedRecordsCount: importedRecords,      ...clientTotals,
      entityTotals: migrationEntityTotals(access),
      rollbackHistory,
      completionChecklist: [
        { key: "template", label: "Download or review resource template", done: true },
        { key: "upload", label: "Upload source file", done: Boolean(lastJob) },
        { key: "dryRun", label: "Run dry-run validation", done: jobs.some((job) => job.dryRun) },
        { key: "import", label: "Import clean records", done: importedRecords > 0 },
        { key: "verify", label: "Verify live modules and analytics", done: importedRecords > 0 && errors === 0 }
      ],
      recentJobs: jobs.slice(0, 5)
    };
  },

  analyze(payload, access) {
    return previewPayload(payload, access, { persist: false, dryRun: true });
  },

  dryRun(payload, access) {
    return previewPayload(payload, access, { persist: false, dryRun: true });
  },

  import(payload, access) {
    assertImportPayloadLimits(payload);
    const precheck = this.canImport(payload, access);
    if (!precheck.allowed && payload.skipApprovalGate !== true) {
      throw badRequest(`Final import blocked: ${precheck.blocked.join(", ")}`);
    }
    const preview = previewPayload(payload, access, { persist: false, dryRun: false });
    const sourceSoftware = sourceKey(payload.sourceSoftware);
    const duplicate = payload.forceImport === true ? null : findDuplicateImportJob(access, {
      sourceSoftware,
      resource: payload.resource || "auto",
      fileName: payload.fileName || preview.fileName,
      totalRows: preview.summary.totalRows,
      sourceFileHash: migrationSourceHash(payload, access)
    });
    if (duplicate) {
      const batch = latestBatchForJob(duplicate.id, access);
      return {
        duplicateImport: true,
        alreadyImported: true,
        job: duplicate,
        jobId: duplicate.id,
        batchId: batch?.id || "",
        summary: duplicate.summary || preview.summary,
        details: this.job(duplicate.id, access),
        message: `This source file was already imported in job ${duplicate.id}. Roll back that job before importing it again.`
      };
    }
    const batchId = makeId("batch");
    const jobId = makeId("mig");
    const branchId = payload.branchId || access.branchId || "";
    const job = withBusyRetry(() => insertMigrationRow("migration_jobs", {
      id: jobId,
      tenantId: access.tenantId,
      sourceSoftware,
      adapter: adapterFor(sourceSoftware),
      resource: payload.resource || "auto",
      fileName: payload.fileName || preview.fileName,
      status: "importing",
      dryRun: 0,
      migrationMode: payload.migrationMode === false ? 0 : 1,
      mapping: preview.mapping,
      settings: importSettings(payload, access),
      totalRows: preview.summary.totalRows,
      summary: preview.summary
    }));
    withBusyRetry(() => insertMigrationRow("migration_import_batches", {
      id: batchId,
      tenantId: access.tenantId,
      jobId,
      sourceSoftware,
      resource: payload.resource || "auto",
      branchId,
      status: "importing",
      summary: preview.summary,
      filters: { branchId, resource: payload.resource || "auto" }
    }));

    const importTx = db.transaction(() => importPreviewRows(preview, { access, batchId, jobId, sourceSoftware, migrationMode: payload.migrationMode !== false, duplicateDecisions: payload.duplicateDecisions || {} }));
    const result = withBusyRetry(() => importTx());
    const finalSummary = { ...preview.summary, ...result, completedAt: now() };
    withBusyRetry(() => updateMigrationRow("migration_jobs", jobId, {
      status: result.errorRows ? "completed_with_errors" : "completed",
      importedRows: result.importedRows,
      skippedRows: result.skippedRows,
      warningRows: result.warningRows,
      errorRows: result.errorRows,
      summary: finalSummary
    }, { tenantId: access.tenantId }));
    withBusyRetry(() => updateMigrationRow("migration_import_batches", batchId, { status: "completed", summary: finalSummary }, { tenantId: access.tenantId }));
    auditMigration("migration.import.completed", { jobId, batchId, summary: finalSummary }, access);
    return { job, jobId, batchId, summary: finalSummary, details: this.job(jobId, access) };
  },

  rollback(jobId, access, filters = {}) {
    auditMigration("migration.rollback.requested", this.buildRollbackAudit({ ...filters, jobId }, access), access);
    return rollbackImports(access, { ...filters, jobId });
  },

  rollbackByFilter(access, filters = {}) {
    auditMigration("migration.rollback.requested", this.buildRollbackAudit(filters, access), access);
    return rollbackImports(access, filters);
  },


  dataQualityScore(summary = {}) {
    const total = Math.max(1, Number(summary.totalRows || 0));
    const validRate = Number(summary.validRows || 0) / total;
    const warningPenalty = Math.min(20, Number(summary.warningRows || 0) * 2);
    const errorPenalty = Math.min(35, Number(summary.errorRows || 0) * 5);
    const duplicatePenalty = Math.min(15, Number(summary.duplicateRows || 0) * 2);
    return Math.max(0, Math.min(100, Math.round(validRate * 100) - warningPenalty - errorPenalty - duplicatePenalty));
  },

  failedRows(payload, access) {
    const preview = previewPayload(payload, access, { persist: false, dryRun: true });
    const rows = (preview.allRows || preview.rows || []).filter(isFailedMigrationRow);
    return {
      fileName: preview.fileName,
      sourceSoftware: preview.sourceSoftware,
      summary: preview.summary,
      dataQualityScore: this.dataQualityScore(preview.summary),
      rows: rows.slice(0, 500)
    };
  },

  migrationAssistant(payload, access) {
    const preview = previewPayload(payload, access, { persist: false, dryRun: true });
    const rows = preview.allRows || preview.rows || [];
    const failed = rows.filter(isFailedMigrationRow);
    const errors = rows.filter((row) => row.status === "error").length;
    const warnings = rows.filter((row) => row.status === "warning").length;
    const duplicates = rows.filter((row) => row.duplicate || /duplicate|already/i.test(String(row.message || ""))).length;
    const anomalies = migrationAnomalySummary(rows);
    const reasons = Array.from(new Set(failed.map((row) => cleanText(row.message || `${row.entity || "record"} row ${row.sourceRowNumber || ""}`)).filter(Boolean))).slice(0, 8);
    return {
      question: cleanText(payload.question || ""),
      answer: `${errors} critical errors, ${warnings} warnings aur ${duplicates} duplicate/conflict rows detect hui. ${reasons.length ? `Top reasons: ${reasons.join(" | ")}.` : "No row-level reason available."} ${errors ? "Final import blocked rahega jab tak critical errors fix nahi hote." : "Critical errors nahi hain; approval gate complete karke import kar sakte ho."}`,
      summary: preview.summary,
      dataQualityScore: this.dataQualityScore(preview.summary),
      anomalies,
      nextActions: errors
        ? ["Fix critical rows", "Re-run analyze", "Run dry-run", "Submit owner approval"]
        : ["Review warnings", "Resolve duplicate decisions", "Run dry-run", "Approve and import"]
    };
  },

  enterprisePreview(payload, access) {
    const preview = previewPayload(payload, access, { persist: false, dryRun: true });
    const rows = preview.allRows || preview.rows || [];
    const qualityScore = this.dataQualityScore(preview.summary);
    return {
      ...preview,
      dataQualityScore: qualityScore,
      approvalGate: migrationApprovalGate(access, preview.summary, approvalIdentityForPayload(payload, preview, access)),
      anomalySummary: migrationAnomalySummary(rows),
      branchWisePreview: preview.summary.byBranch || {},
      requiredMappingComplete: requiredMappingComplete(payload.mapping || {}, payload.resource || ""),
      sandboxMode: payload.sandboxMode !== false,
      failedRows: rows.filter(isFailedMigrationRow).slice(0, 100),
      conflictResolver: rows.filter((row) => row.duplicate || /duplicate|already/i.test(String(row.message || ""))).slice(0, 100).map((row) => ({
        rowKey: `${row.sourceSheet}:${row.sourceRowNumber}`,
        entity: row.entity,
        message: row.message,
        decisions: ["merge", "keep", "replace", "skip", "link"]
      })),
      packageBuilder: buildMigrationPackage(preview),
      resumeToken: buildResumeToken(preview)
    };
  },

  canImport(payload, access) {
    const preview = previewPayload(payload, access, { persist: false, dryRun: true });
    const gate = migrationApprovalGate(access, preview.summary, approvalIdentityForPayload(payload, preview, access));
    const mappingReady = requiredMappingComplete(payload.mapping || {}, payload.resource || "");
    const blocked = [];
    const allowPartialImport = payload.allowPartialImport === true;
    if (Number(preview.summary.errorRows || 0) > 0 && !allowPartialImport) blocked.push("critical_errors_present");
    if (!gate.approved) blocked.push("owner_approval_required");
    if (!mappingReady) blocked.push("required_mapping_incomplete");
    return {
      allowed: blocked.length === 0,
      blocked,
      approvalGate: gate,
      mappingReady,
      allowPartialImport,
      dataQualityScore: this.dataQualityScore(preview.summary),
      summary: preview.summary
    };
  },

  buildRollbackAudit(payload = {}, access = {}) {
    return {
      id: makeId("rba"),
      tenantId: access.tenantId,
      jobId: cleanText(payload.jobId || ""),
      batchId: cleanText(payload.batchId || ""),
      reason: cleanText(payload.reason || "manual rollback"),
      actorUserId: access.userId || "system",
      createdAt: now(),
      required: true
    };
  },

  rollbackLast(access, filters = {}) {
    const batch = db
      .prepare("SELECT * FROM migration_import_batches WHERE tenantId = ? AND status <> 'rolled_back' AND rolledBackAt = '' ORDER BY createdAt DESC LIMIT 1")
      .get(access.tenantId);
    if (!batch) return { ok: false, message: "No active import batch found for rollback.", deleted: {} };
    auditMigration("migration.rollback.requested", this.buildRollbackAudit({ ...filters, batchId: batch.id }, access), access);
    return rollbackImports(access, { ...filters, batchId: batch.id });
  }
};


function isFailedMigrationRow(row) {
  const message = String(row?.message || "").toLowerCase();
  return row?.status === "error"
    || row?.status === "warning"
    || row?.status === "duplicate"
    || Boolean(row?.duplicate)
    || message.includes("duplicate")
    || message.includes("already");
}

function migrationAnomalySummary(rows = []) {
  const invalidDates = rows.filter((row) => /date|future|invalid/i.test(String(row.message || ""))).length;
  const contactIssues = rows.filter((row) => /phone|mobile|email/i.test(String(row.message || ""))).length;
  const moneyIssues = rows.filter((row) => /negative|amount|payment|invoice|discount|balance/i.test(String(row.message || ""))).length;
  const referenceIssues = rows.filter((row) => /reference|could not be resolved|unknown/i.test(String(row.message || ""))).length;
  return {
    invalidDates,
    contactIssues,
    moneyIssues,
    referenceIssues,
    riskLevel: moneyIssues || invalidDates || referenceIssues ? "high" : contactIssues ? "medium" : "normal"
  };
}

function migrationApprovalGate(access = {}, summary = {}, identityInput = {}) {
  ensureMigrationApprovalSchema();
  const identity = normalizeApprovalIdentity(identityInput, summary);
  const approvals = db
    .prepare("SELECT * FROM migration_approvals WHERE tenantId = @tenantId AND status = 'approved' ORDER BY createdAt DESC LIMIT 100")
    .all({ tenantId: access.tenantId })
    .map(deserializeApproval);
  const matched = approvals.find((approval) => approvalMatchesIdentity(approval, identity));
  const approved = Boolean(matched);
  const hasErrors = Number(summary.errorRows || 0) > 0;
  return {
    approved,
    approvalId: matched?.id || "",
    identity,
    allowed: approved && !hasErrors,
    reason: hasErrors ? "critical_errors_present" : approved ? "approved" : "owner_approval_required_for_exact_job"
  };
}

function normalizeApprovalIdentity(identity = {}, summary = {}) {
  const sourceEvidence = identity.sourceEvidence || summary.sourceEvidence || summary.summary?.sourceEvidence || {};
  return {
    jobId: cleanText(identity.jobId),
    resource: canonicalResource(identity.resource || "") || cleanText(identity.resource || summary.resource || "auto") || "auto",
    sourceSoftware: sourceKey(identity.sourceSoftware || summary.sourceSoftware || ""),
    fileName: cleanText(identity.fileName || sourceEvidence.fileName || summary.fileName),
    sourceFileHash: cleanText(identity.sourceFileHash || sourceEvidence.sha256 || summary.sourceFileHash),
    totalRows: integer(identity.totalRows ?? summary.totalRows ?? summary.summary?.totalRows, 0)
  };
}

function approvalIdentityForPayload(payload = {}, preview = {}, access = {}) {
  const summary = preview.summary || {};
  return normalizeApprovalIdentity({
    jobId: payload.jobId || "",
    resource: payload.resource || "auto",
    sourceSoftware: payload.sourceSoftware || preview.sourceSoftware || summary.sourceSoftware || "",
    fileName: payload.fileName || preview.fileName || summary.fileName || "",
    sourceFileHash: payload.sourceFileHash || migrationSourceHash(payload, access) || "",
    totalRows: payload.totalRows || summary.totalRows || 0,
    sourceEvidence: summary.sourceEvidence
  }, summary);
}

function approvalIdentityForJob(job = {}, summary = {}) {
  return normalizeApprovalIdentity({
    jobId: job.id,
    resource: job.resource || "auto",
    sourceSoftware: job.sourceSoftware,
    fileName: job.fileName,
    sourceFileHash: job.settings?.sourceFileHash || job.sourceFileHash || "",
    totalRows: job.totalRows || summary.totalRows || 0,
    sourceEvidence: job.settings?.sourceEvidence || summary.sourceEvidence
  }, summary);
}

function approvalIdentityFromSubmission(payload = {}) {
  const summary = payload.summary || {};
  const nestedSummary = summary.summary || summary;
  const sourceEvidence = payload.sourceEvidence || summary.sourceEvidence || nestedSummary.sourceEvidence || {};
  return normalizeApprovalIdentity({
    jobId: payload.jobId,
    resource: payload.resource || nestedSummary.resource || "auto",
    sourceSoftware: payload.sourceSoftware || summary.sourceSoftware || nestedSummary.sourceSoftware,
    fileName: payload.fileName || summary.fileName || nestedSummary.fileName,
    sourceFileHash: payload.sourceFileHash || summary.sourceFileHash || nestedSummary.sourceFileHash,
    totalRows: payload.totalRows ?? nestedSummary.totalRows ?? summary.totalRows,
    sourceEvidence
  }, nestedSummary);
}

function approvalMatchesIdentity(approval = {}, identity = {}) {
  const approvalJobId = cleanText(approval.jobId);
  const identityJobId = cleanText(identity.jobId);
  return Boolean(identityJobId && approvalJobId && approvalJobId === identityJobId);
}

function requiredMappingComplete(mapping = {}, resource = "") {
  const canonical = canonicalResource(resource || "");
  if (!canonical) return true;
  const required = RESOURCE_TEMPLATES[canonical]?.required || [];
  if (!required.length) return true;
  const mappedTargets = new Set(Object.values(mapping || {}).filter(Boolean));
  return required.every((field) => mappedTargets.has(field));
}

function buildMigrationPackage(preview = {}) {
  const byResource = preview.summary?.byResource || {};
  const order = RESOURCE_ORDER.filter((resource) => byResource[resource]);
  return {
    packageId: makeId("mpkg"),
    fileName: preview.fileName,
    order,
    steps: order.map((resource, index) => ({
      step: index + 1,
      resource,
      totalRows: byResource[resource]?.total || 0,
      errors: byResource[resource]?.errors || 0,
      warnings: byResource[resource]?.warnings || 0,
      action: index === 0 ? "import foundation records first" : "import after dependencies are ready"
    })),
    dependencyRule: "clients, staff, services, products/vendors first; appointments, sales, invoices, payments after references are ready"
  };
}

function buildResumeToken(preview = {}) {
  return {
    token: `resume_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    fileName: preview.fileName,
    totalRows: preview.summary?.totalRows || 0,
    validRows: preview.summary?.validRows || 0,
    createdAt: now(),
    note: "Use with future resume endpoint to continue after last successful row."
  };
}


function normalizeFlexiSourceRows(parsed = {}, sourceSoftware = "csv") {
  const account = flexiSheet(parsed, "dbo.AccountMaster");
  const productService = flexiSheet(parsed, "dbo.ProdServMaster");
  const appointmentsMain = flexiSheet(parsed, "dbo.AppointMentMain");
  const appointmentsChild = flexiSheet(parsed, "dbo.AppointMentChild");
  const slipMain = flexiSheet(parsed, "dbo.SlipMain");
  const slipBalance = flexiSheet(parsed, "dbo.SlipBalAmt");
  const stock = flexiSheet(parsed, "dbo.Stock");
  const membership = flexiSheet(parsed, "dbo.ClientMShip");
  const expenses = flexiSheet(parsed, "dbo.ExpenceDetail");
  if (!account.length && !productService.length && !appointmentsChild.length && !slipBalance.length) return [];

  const rows = [];
  const accountByCode = new Map(account.map((row) => [flexiKey(row.BranchCode, row.Code), row]));
  const serviceByCode = new Map(productService.map((row) => [cleanText(row.Code), row]));
  const appointmentByDoc = new Map(appointmentsMain.map((row) => [flexiDocKey(row), row]));
  const slipByDoc = new Map(slipMain.map((row) => [flexiDocKey(row), row]));

  account.filter((row) => cleanKey(row.Flag) === "cl" && cleanText(row.Name)).forEach((row, index) => rows.push(flexiRow("clients", {
    originalRecordId: flexiKey(row.BranchCode, row.Code),
    name: row.Name,
    phone: row.Mobile1 || row.TMobile1,
    email: row.EMail,
    gender: cleanText(row.Female) === "1" ? "female" : "",
    birthday: row.DOB,
    anniversary: row.DOA,
    tags: row.Salutation,
    notes: [row.Remarks, row.RefThru].filter(Boolean).join("; "),
    branchId: "",
    branchName: row.CurrBranch || row.Branch,
    createdAt: row.CDate
  }, row, "dbo.AccountMaster/clients", index)));

  account.filter((row) => cleanKey(row.Flag) === "emp" && cleanText(row.Name)).forEach((row, index) => rows.push(flexiRow("staff", {
    originalRecordId: flexiKey(row.BranchCode, row.Code),
    name: row.Name,
    role: row.Designation || row.EMPType || "Stylist",
    phone: row.Mobile1 || row.TMobile1,
    email: row.EMail,
    branchId: "",
    branchName: row.CurrBranch || row.Branch,
    shift: row.ShiftCode,
    status: cleanText(row.Hide) === "1" ? "inactive" : "active",
    createdAt: row.DOJ || row.CDate
  }, row, "dbo.AccountMaster/staff", index)));

  account.filter((row) => ["acs", "sup", "pur"].includes(cleanKey(row.Flag)) && cleanText(row.Name)).forEach((row, index) => rows.push(flexiRow("vendors", {
    originalRecordId: flexiKey(row.BranchCode, row.Code),
    name: row.Name,
    contactName: row.ShortName,
    phone: row.Mobile1 || row.TMobile1,
    email: row.EMail,
    gstin: row.GSTINNo,
    address: "",
    status: cleanText(row.Hide) === "1" ? "inactive" : "active",
    createdAt: row.CDate
  }, row, "dbo.AccountMaster/vendors", index)));

  productService.filter((row) => cleanKey(row.Flag) === "sl" && cleanText(row.Name)).forEach((row, index) => rows.push(flexiRow("services", {
    originalRecordId: row.Code,
    name: row.Name,
    category: row.CategoryCode || "Imported",
    price: flexiMoney(row.Rate || row.RateMember),
    durationMinutes: integer(row.TimeTaken, 0),
    gstRate: flexiGstRate(row.GSTTaxCode || row.TaxCode),
    status: cleanText(row.Hide) === "1" ? "inactive" : "active",
    createdAt: ""
  }, row, "dbo.ProdServMaster/services", index)));

  productService.filter((row) => cleanKey(row.Flag) === "pl" && cleanText(row.Name)).forEach((row, index) => rows.push(flexiRow("products", {
    originalRecordId: row.Code,
    name: row.Name,
    sku: row.BarCode || row.Code,
    category: row.CategoryCode || "Imported",
    supplier: row.MfgCCode || row.TCompany,
    branchId: "",
    branchName: "",
    stock: flexiMoney(row.OpgQty),
    lowStockThreshold: flexiMoney(row.MinQty || row.OrdLevQty),
    expiryDate: "",
    unitCost: flexiMoney(row.CostRate || row.COP || row.LastCostRate),
    price: flexiMoney(row.Rate || row.LastMRP),
    gstRate: flexiGstRate(row.GSTTaxCode || row.TaxCode),
    createdAt: ""
  }, row, "dbo.ProdServMaster/products", index)));

  stock.filter((row) => cleanText(row.PCode)).forEach((row, index) => rows.push(flexiRow("inventory", {
    originalRecordId: `stock:${flexiDocKey(row)}:${row.Sno || index + 1}`,
    productId: row.PCode,
    productName: serviceByCode.get(cleanText(row.PCode))?.Name || "",
    sku: row.PCode,
    branchId: "",
    branchName: row.Branch,
    type: numberValue(row.RecQty) > 0 ? "stock_in" : "stock_out",
    quantity: numberValue(row.RecQty) > 0 ? flexiMoney(row.RecQty) : flexiMoney(-Math.abs(numberValue(row.IssQty))),
    unitCost: flexiMoney(row.CostRate || row.Rate),
    reason: "Flexi stock migration",
    createdAt: row.DocDate
  }, row, "dbo.Stock", index)));

  membership.filter((row) => cleanText(row.ClientCode) && cleanText(row.MShipCode)).forEach((row, index) => rows.push(flexiRow("memberships", {
    originalRecordId: `membership:${flexiKey(row.BranchCode, row.ClientCode)}:${row.MShipCode}:${row.MShipNo || index + 1}`,
    clientId: flexiKey(row.BranchCode, row.ClientCode),
    clientName: row.ClientName,
    clientPhone: accountByCode.get(flexiKey(row.BranchCode, row.ClientCode))?.Mobile1 || "",
    planName: `Legacy Membership ${row.MShipCode}`,
    price: "0.00",
    planCredits: "0",
    creditsRemaining: "0",
    validityDate: row.DOE,
    autoRenew: "false",
    branchId: "",
    branchName: row.Branch,
    createdAt: row.DOR || row.CDate
  }, row, "dbo.ClientMShip", index)));

  appointmentsChild.filter((row) => cleanText(row.DocNo)).forEach((row, index) => {
    const main = appointmentByDoc.get(flexiDocKey(row)) || {};
    const client = accountByCode.get(flexiKey(main.CBranchCode || main.BranchCode, main.ClientCode));
    const staff = accountByCode.get(flexiKey(row.OprBranchCode, row.OprCode));
    rows.push(flexiRow("appointments", {
      originalRecordId: `appt:${flexiDocKey(row)}:${row.Sno || index + 1}`,
      clientId: flexiKey(main.CBranchCode || main.BranchCode, main.ClientCode || ""),
      clientName: client?.Name || "",
      clientPhone: main.ContactNo || client?.Mobile1 || "",
      staffId: flexiKey(row.OprBranchCode, row.OprCode),
      staffName: staff?.Name || "",
      serviceId: row.ServCode,
      serviceIds: row.ServCode,
      serviceName: serviceByCode.get(cleanText(row.ServCode))?.Name || row.ServCode,
      branchId: "",
      branchName: row.Branch,
      startAt: flexiDateTime(row.DocDate || main.DocDate, row.StartTime || main.ATTime),
      endAt: "",
      status: flexiAppointmentStatus(row.Status),
      source: "FlexiSalonERP",
      chair: row.RoomCode,
      notes: [main.Remarks, row.Remarks].filter(Boolean).join("; "),
      createdAt: main.CDate || row.DocDate
    }, row, "dbo.AppointMentChild", index));
  });

  slipBalance.filter((row) => cleanText(row.DocNo)).forEach((row, index) => {
    const main = slipByDoc.get(flexiDocKey(row)) || {};
    const client = accountByCode.get(flexiKey(row.AccBranchCode, row.AccCode));
    const common = {
      originalRecordId: `sale:${flexiDocKey(row)}`,
      clientId: flexiKey(row.AccBranchCode, row.AccCode),
      clientName: client?.Name || main.Person || "",
      clientPhone: client?.Mobile1 || "",
      staffId: "",
      staffName: "",
      branchId: "",
      branchName: row.Branch,
      subtotal: flexiMoney(row.TotalAmt),
      discount: flexiMoney(main.DedDiscAmt || main.DiscAmt),
      gstAmount: flexiMoney(main.TaxAmt || main.IGSTAmt || main.CGSTAmt || main.SGSTAmt),
      total: flexiMoney(row.TotalAmt),
      status: "completed",
      createdAt: row.DocDate
    };
    rows.push(flexiRow("sales", { ...common, serviceName: "", lineItem: "" }, row, "dbo.SlipBalAmt/sales", index));
    rows.push(flexiRow("invoices", {
      // Spread common first, then override originalRecordId — otherwise common's
      // `sale:<docKey>` id clobbers the invoice key and payments (which point at
      // `invoice:<docKey>`) can never resolve their invoice.
      ...common,
      originalRecordId: `invoice:${flexiDocKey(row)}`,
      invoiceNumber: row.SSInvNo || row.DocNo,
      saleId: common.originalRecordId,
      paid: flexiMoney(Math.max(0, numberValue(row.TotalAmt) - numberValue(row.BalAmt))),
      balance: flexiMoney(row.BalAmt)
    }, row, "dbo.SlipBalAmt/invoices", index));
  });

  slipMain.filter((row) => cleanText(row.DocNo)).forEach((row, index) => {
    for (const mode of [
      ["cash", row.CashAmt],
      ["card", row.CardAmt],
      ["cheque", row.ChequeAmt],
      ["third_party", row.TPartyAmt]
    ]) {
      if (numberValue(mode[1]) <= 0) continue;
      rows.push(flexiRow("payments", {
        invoiceId: `invoice:${flexiDocKey(row)}`,
        invoiceNumber: row.SSINVNo || row.DocNo,
        originalRecordId: `payment:${flexiDocKey(row)}:${mode[0]}`,
        mode: mode[0],
        paymentMode: mode[0],
        amount: flexiMoney(mode[1]),
        reference: row.RefNo || row.PaymentTxn,
        branchId: "",
        branchName: row.Branch,
        createdAt: row.DocDate
      }, row, "dbo.SlipMain/payments", index));
    }
  });

  expenses.filter((row) => cleanKey(row.DocType) === "og" && cleanText(row.DocNo)).forEach((row, index) => rows.push(flexiRow("expenses", {
    originalRecordId: `expense:${flexiDocKey(row)}:${row.SNo || index + 1}`,
    branchId: "",
    branchName: row.Branch,
    category: row.Type || "Imported",
    vendor: accountByCode.get(flexiKey(row.AccBranchCode, row.AccCode))?.Name || row.AccCode,
    amount: flexiMoney(row.Amount),
    taxAmount: "0.00",
    paymentMode: "card",
    paidAt: row.DocDate,
    notes: row.Remarks || row.Reason,
    createdAt: row.DocDate
  }, row, "dbo.ExpenceDetail", index)));

  rows.mapping = {};
  rows.unmatchedColumns = [];
  return rows;
}

function flexiSheet(parsed = {}, name = "") {
  const wanted = cleanKey(name);
  return (parsed.sheets || []).find((sheet) => cleanKey(sheet.name).endsWith(wanted))?.rows || [];
}

function flexiRow(resource, fields, raw, sourceSheet, index) {
  return {
    resource,
    entity: resource,
    sourceSheet,
    sourceRowNumber: index + 2,
    sourceExternalId: cleanText(fields.originalRecordId) || `${sourceSheet}:${index + 2}`,
    raw,
    fields,
    payload: fields,
    sourceSoftware: "csv"
  };
}

function flexiKey(branchCode, code) {
  const branch = cleanText(branchCode);
  const value = cleanText(code);
  return branch && value ? `${branch}:${value}` : value;
}

function flexiDocKey(row = {}) {
  return [row.BranchCode, row.DocType, row.Prefix, row.DocNo].map(cleanText).filter(Boolean).join(":");
}

function flexiMoney(value) {
  return numberValue(value, 0).toFixed(2);
}

function flexiGstRate(value) {
  const match = cleanText(value).match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : "18";
}

function flexiDateTime(date, time) {
  const datePart = cleanText(date).slice(0, 10);
  const timePart = cleanText(time).match(/\d{1,2}:\d{2}(?::\d{2})?/);
  return datePart ? `${datePart}T${timePart ? timePart[0] : "00:00:00"}` : "";
}

function flexiAppointmentStatus(value) {
  const status = cleanKey(value);
  if (["c", "cancel", "cancelled"].includes(status)) return "cancelled";
  if (["co", "complete", "completed", "done"].includes(status)) return "completed";
  return "booked";
}
const AURA_PACKAGE_ORDER = [
  "clients",
  "staff",
  "services",
  "products",
  "vendors",
  "inventory",
  "memberships",
  "appointments",
  "sales",
  "invoices",
  "payments",
  "expenses"
];

function storeMigrationUpload(upload, access) {
  auditMigration("migration.upload.stored", {
    fileRef: upload.fileRef,
    fileName: upload.fileName,
    sizeBytes: upload.sizeBytes,
    sha256: upload.sha256
  }, access);
  return upload;
}
function normalizeSourcePackage(payload = {}, access = {}) {
  const source = uploadedBufferSource(payload, access, "migration-source.zip", "fileBase64 or fileRef is required to normalize a migration source.");
  const sourceSoftware = sourceKey(payload.sourceSoftware);
  const readyPackage = auraReadyZipPackage(source, sourceSoftware);
  if (readyPackage) return readyPackage;
  const parsed = parseUploadedBuffer(source.fileName, source.buffer, {
    maxEntries: 500,
    maxUncompressedBytes: 180 * 1024 * 1024,
    preferCsv: true
  });
  const flexiRows = normalizeFlexiSourceRows(parsed, sourceSoftware);
  const normalizedRows = flexiRows.length ? flexiRows : normalizeParsedRows(parsed, { ...payload, resource: payload.resource || "" }, access, sourceSoftware);
  const orderedRows = dependencyOrderedRows(normalizedRows).filter((row) => payload.includeClients === false ? row.resource !== "clients" : true);
  if (!orderedRows.length) {
    throw badRequest("No Aura-supported migration tables were detected in this source file. Add CSV/XLSX files named for clients, staff, services, products, appointments, invoices, payments or expenses.");
  }
  const byResource = groupNormalizedRows(orderedRows);
  const files = [];
  const manifestFiles = [];
  let totalRows = 0;
  for (const resource of AURA_PACKAGE_ORDER) {
    const rows = byResource[resource] || [];
    if (!rows.length) continue;
    const fileName = `${String(AURA_PACKAGE_ORDER.indexOf(resource) + 1).padStart(2, "0")}_${resource}.csv`;
    const csv = canonicalCsvForResource(resource, rows);
    files.push({ name: fileName, data: csv });
    totalRows += rows.length;
    manifestFiles.push({ file: fileName, resource, rows: rows.length, sizeBytes: Buffer.byteLength(csv, "utf8") });
  }
  const manifest = {
    generatedAt: now(),
    sourceFileName: parsed.fileName,
    sourceSoftware,
    targetSourceSoftware: "csv",
    fileCount: manifestFiles.length,
    totalRows,
    files: manifestFiles,
    usage: "Upload/analyze this generated package with Source Software Generic CSV and Resource Auto-detect by sheet name."
  };
  files.unshift({ name: "00_manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` });
  const zip = createZipArchive(files);
  return {
    normalized: true,
    sourceFileName: parsed.fileName,
    sourceSoftware,
    targetSourceSoftware: "csv",
    targetResource: "auto",
    fileName: appReadyPackageName(parsed.fileName, payload.includeClients === false),
    fileBase64: zip.toString("base64"),
    fileSizeBytes: zip.length,
    summary: manifest,
    files: manifestFiles,
    mapping: normalizedRows.mapping || {},
    unmatchedColumns: normalizedRows.unmatchedColumns || []
  };
}

function parseNormalizationPayload(payload = {}, access = {}) {
  const source = uploadedBufferSource(payload, access, "migration-source.zip", "fileBase64 or fileRef is required to normalize a migration source.");
  return parseUploadedBuffer(source.fileName, source.buffer, {
    maxEntries: 500,
    maxUncompressedBytes: 180 * 1024 * 1024,
    preferCsv: true
  });
}

function auraReadyZipPackage(source = {}, sourceSoftware = "csv") {
  if (!isZipUpload(source.fileName)) return null;
  let entries = [];
  try {
    entries = extractZipEntries(source.buffer, { maxEntries: 75, maxUncompressedBytes: 180 * 1024 * 1024 });
  } catch (_err) {
    return null;
  }
  const csvEntries = entries.filter((entry) => isCsvUpload(entry.name));
  const manifestEntry = entries.find((entry) => String(entry.name || "").toLowerCase().endsWith("00_manifest.json"));
  const resourceEntries = csvEntries
    .map((entry) => ({ entry, resource: auraResourceFromPackageFile(entry.name) }))
    .filter((item) => item.resource);
  const looksReady = Boolean(manifestEntry) || resourceEntries.length >= 2 || String(source.fileName || "").toLowerCase().includes("aura-app-import-ready");
  if (!looksReady || !resourceEntries.length) return null;
  const files = [];
  let totalRows = 0;
  for (const item of resourceEntries) {
    const rows = parseCsvChunkRows({ csvText: item.entry.data.toString("utf8") });
    totalRows += rows.length;
    files.push({ file: `${sourceNameForFile(item.entry.name)}.csv`, resource: item.resource, rows: rows.length, sizeBytes: item.entry.data.length });
  }
  const manifest = {
    generatedAt: now(),
    sourceFileName: source.fileName,
    sourceSoftware,
    targetSourceSoftware: "csv",
    fileCount: files.length,
    totalRows,
    files,
    usage: "Already Aura-ready. Upload/analyze with Source Software Generic CSV and Resource Auto-detect by sheet name."
  };
  return {
    normalized: true,
    alreadyAuraReady: true,
    sourceFileName: source.fileName,
    sourceSoftware,
    targetSourceSoftware: "csv",
    targetResource: "auto",
    fileName: source.fileName,
    fileBase64: source.buffer.toString("base64"),
    fileSizeBytes: source.buffer.length,
    summary: manifest,
    files,
    mapping: {},
    unmatchedColumns: []
  };
}

function auraResourceFromPackageFile(fileName = "") {
  const base = sourceNameForFile(fileName).toLowerCase().replace(/^\d+[_-]/, "");
  return AURA_PACKAGE_ORDER.includes(base) ? base : "";
}

function groupNormalizedRows(rows = []) {
  return rows.reduce((grouped, row) => {
    grouped[row.resource] = grouped[row.resource] || [];
    grouped[row.resource].push(row);
    return grouped;
  }, {});
}

function canonicalCsvForResource(resource, rows = []) {
  const template = RESOURCE_TEMPLATES[resource];
  if (!template) return "";
  const header = template.fields;
  const lines = rows.map((row) => header.map((field) => csvValue(normalizedFieldValue(row, field))).join(","));
  return `\uFEFF${header.join(",")}\n${lines.join("\n")}\n`;
}

function normalizedFieldValue(row = {}, field = "") {
  if (row.fields && row.fields[field] !== undefined && row.fields[field] !== null && row.fields[field] !== "") return row.fields[field];
  if (row.payload && row.payload[field] !== undefined && row.payload[field] !== null) return row.payload[field];
  if (field === "paymentMode" && row.payload?.mode) return row.payload.mode;
  if (field === "mode" && row.payload?.paymentMode) return row.payload.paymentMode;
  if (field === "branchName" && row.fields?.branch) return row.fields.branch;
  return "";
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join("|") : cleanText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function appReadyPackageName(fileName = "migration-source.zip", withoutClients = false) {
  const base = sourceNameForFile(fileName).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "migration-source";
  return `aura-import-${base}${withoutClients ? "-without-clients" : ""}.zip`;
}
function previewPayload(payload, access, { persist, dryRun, jobId = "" }) {
  const parsed = parsePayload(payload, access);
  assertImportPayloadLimits(payload, parsed);
  const sourceSoftware = sourceKey(payload.sourceSoftware);
  const normalized = normalizeParsedRows(parsed, payload, access, sourceSoftware);
  const relationJobId = jobId || cleanText(payload.jobId);
  // In Large Mode each chunk/resource is analyzed in isolation. Without the
  // job's other staged rows as references, cross-chunk dependencies (payments →
  // invoices, appointments/memberships/sales → clients) cannot resolve and are
  // wrongly flagged as critical "reference could not be resolved" errors. Seed
  // the resolution context with the job's already-staged dependency rows so
  // these resolve exactly as they do in single-payload (normal-mode) analysis.
  const crossReferences = relationJobId ? loadJobStagedReferenceRows(relationJobId, access) : [];
  const context = createContext(access, crossReferences.length ? [...normalized, ...crossReferences] : normalized);
  const summary = emptySummary(sourceSoftware, parsed.fileName, dryRun);
  const sourceEvidence = migrationSourceEvidence(payload, access, parsed.fileName);
  const seen = new Set();
  const rows = normalized.map((row) => {
    const resolved = { ...row, payload: resolveMigrationRelations(row.payload, row, { access, jobId: relationJobId }) };
    const checked = validatePreparedRow(resolved, context, seen);
    addSummary(summary, resolved.resource, checked);
    return { ...resolved, ...checked, sourceSoftware };
  });
  summary.affectedRecords = summary.validRows + summary.warningRows;
  summary.byBranch = branchSummary(rows);
  if (sourceEvidence) summary.sourceEvidence = sourceEvidence;
  // Verifiable fix-version diagnostics so the UI/operator can confirm the new
  // analyzer path actually ran for this upload (instead of a cached old job).
  summary.diagnostics = {
    analyzerFixVersion: ANALYZER_FIX_VERSION,
    adapter: adapterFor(sourceSoftware),
    sourceSoftware,
    largeMode: Boolean(relationJobId),
    crossChunkReferencesLoaded: crossReferences.length,
    paymentInvoiceUnresolved: rows.filter((r) => r.resource === "payments" && /invoice reference could not be resolved/i.test(String(r.message || ""))).length,
    clientPhoneMissing: rows.filter((r) => r.resource === "clients" && (r.warnings || []).some((w) => /phone missing/i.test(String(w)))).length
  };
  const response = {
    sourceSoftware,
    fileName: parsed.fileName,
    mapping: normalized.mapping || {},
    unmatchedColumns: normalized.unmatchedColumns || [],
    sourceEvidence,
    summary,
    rows: rows.slice(0, 500)
  };
  Object.defineProperty(response, "allRows", { value: rows, enumerable: false });
  if (persist) persistPreview(response, access, dryRun);
  auditMigration(dryRun ? "migration.dry_run.completed" : "migration.preview.completed", { summary }, access);
  return response;
}

function verifiedCsvChunkChecksum(payload = {}) {
  const checksum = csvChunkChecksum(payload);
  const provided = cleanText(payload.checksum || "");
  if (provided && provided !== checksum) {
    throw badRequest("CSV chunk checksum does not match uploaded content.");
  }
  return checksum;
}

function csvChunkChecksum(payload = {}) {
  const header = Array.isArray(payload.header) ? payload.header.map((item) => cleanText(item)) : [];
  const csvText = String(payload.csvText || "").replace(/^\uFEFF/, "");
  return createHash("sha256").update(JSON.stringify({ header, csvText }), "utf8").digest("hex");
}

export function parseCsvChunkRows(payload = {}) {
  const csvText = String(payload.csvText || "").replace(/^\uFEFF/, "");
  const header = Array.isArray(payload.header) ? payload.header.map((item) => cleanText(item)) : [];
  const records = csvRecords(csvText);
  const headers = header.length ? header : (records.shift() || []).map((item, index) => cleanText(item) || `column${index + 1}`);
  if (!headers.length) return [];
  return records
    .filter((record) => record.some((value) => cleanText(value)))
    .map((record) => Object.fromEntries(headers.map((name, index) => [name || `column${index + 1}`, record[index] ?? ""])));
}

function csvRecords(text = "") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
function parsePayload(payload = {}, access = {}) {
  if (Array.isArray(payload.rows)) {
    return {
      fileName: payload.fileName || "manual-records",
      sheets: [{ name: payload.resource || "clients", rows: payload.rows }]
    };
  }
  const source = uploadedBufferSource(payload, access, "migration.xlsx", "fileBase64, fileRef, or rows is required.");
  return parseUploadedBuffer(source.fileName, source.buffer);
}

function uploadedBufferSource(payload = {}, access = {}, fallbackFileName = "migration.xlsx", requiredMessage = "fileBase64 or fileRef is required.") {
  if (payload.fileRef) {
    const upload = migrationUploadStore.read(payload.fileRef, access);
    return { fileName: payload.fileName || upload.fileName || fallbackFileName, buffer: upload.buffer };
  }
  if (!payload.fileBase64) throw badRequest(requiredMessage);
  const base64 = String(payload.fileBase64).includes(",") ? String(payload.fileBase64).split(",").pop() : payload.fileBase64;
  return { fileName: payload.fileName || fallbackFileName, buffer: Buffer.from(base64, "base64") };
}

function parseUploadedBuffer(fileName, buffer, options = {}) {
  if (isZipUpload(fileName)) return parseZipPayload(fileName, buffer, options);
  if (isCsvUpload(fileName)) {
    return {
      fileName,
      sheets: [{ name: sourceNameForFile(fileName), rows: parseCsvChunkRows({ csvText: buffer.toString("utf8") }) }]
    };
  }
  return {
    fileName,
    sheets: parseWorkbookSheets(buffer)
  };
}

function parseZipPayload(fileName, buffer, options = {}) {
  let entries = extractZipEntries(buffer, { maxEntries: options.maxEntries || 75, maxUncompressedBytes: options.maxUncompressedBytes || 75 * 1024 * 1024 })
    .filter((entry) => isSupportedZipMigrationFile(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const csvEntries = entries.filter((entry) => isCsvUpload(entry.name));
  if (options.preferCsv && csvEntries.length) entries = csvEntries;
  if (!entries.length) throw badRequest("ZIP archive must contain at least one .csv, .xls or .xlsx migration file.");
  const sheets = [];
  for (const entry of entries) {
    const sourceName = sourceNameForFile(entry.name);
    if (isCsvUpload(entry.name)) {
      sheets.push({ name: sourceName, rows: parseCsvChunkRows({ csvText: entry.data.toString("utf8") }) });
      continue;
    }
    sheets.push(...parseWorkbookSheets(entry.data, sourceName));
  }
  if (!sheets.length) throw badRequest("ZIP archive did not produce any migration rows.");
  return { fileName, sheets };
}

function parseWorkbookSheets(buffer, prefix = "") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  return workbook.SheetNames.map((name) => ({
    name: prefix ? `${prefix}/${name}` : name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false })
  }));
}

function isZipUpload(fileName = "") {
  return cleanText(fileName).toLowerCase().endsWith(".zip");
}

function isCsvUpload(fileName = "") {
  return cleanText(fileName).toLowerCase().endsWith(".csv");
}

function isSpreadsheetUpload(fileName = "") {
  const lower = cleanText(fileName).toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}

function isSupportedZipMigrationFile(fileName = "") {
  const normalized = String(fileName || "").replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (!lower || lower.endsWith("/") || lower.startsWith("__macosx/") || lower.split("/").some((part) => part.startsWith("."))) return false;
  return isCsvUpload(lower) || isSpreadsheetUpload(lower);
}

function sourceNameForFile(fileName = "") {
  return String(fileName || "migration")
    .replace(/\\/g, "/")
    .replace(/^.*?([^/]+)$/g, "$1")
    .replace(/\.(csv|xlsx|xls)$/i, "") || "migration";
}
function normalizeParsedRows(parsed, payload, access, sourceSoftware) {
  const allMappings = {};
  const allUnmatched = [];
  const requestedResource = canonicalResource(payload.resource || "");
  const branchLookup = buildBranchLookup(access);
  const rows = parsed.sheets.flatMap((sheet) => {
    const resource = requestedResource || canonicalResource(detectResource(sheet.name));
    if (!resource) return [];
    const columns = Object.keys(sheet.rows[0] || {});
    const auto = autoMapColumns(columns, resource);
    const mapping = mergeMapping(auto.mapping, payload.mapping || {}, columns, resource);
    allMappings[sheet.name] = mapping;
    allUnmatched.push(...auto.unmatched.filter((column) => !mapping[column]));
    return sheet.rows
      .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""))
      .map((raw, index) => prepareRow({ raw, mapping, resource, sourceSheet: sheet.name, sourceRowNumber: index + 2, access, sourceSoftware, branchLookup }));
  });
  ensureUniqueInvoiceNumbers(rows, access);
  rows.mapping = allMappings;
  rows.unmatchedColumns = Array.from(new Set(allUnmatched));
  return rows.sort((a, b) => RESOURCE_ORDER.indexOf(a.resource) - RESOURCE_ORDER.indexOf(b.resource));
}

function dependencyOrderedRows(rows = []) {
  return [...(rows || [])].sort((left, right) => {
    const byResource = resourceRank(left.resource) - resourceRank(right.resource);
    if (byResource) return byResource;
    const bySheet = cleanText(left.sourceSheet).localeCompare(cleanText(right.sourceSheet));
    if (bySheet) return bySheet;
    return Number(left.sourceRowNumber || 0) - Number(right.sourceRowNumber || 0);
  });
}

function resourceRank(resource) {
  const index = RESOURCE_ORDER.indexOf(resource);
  return index >= 0 ? index : RESOURCE_ORDER.length;
}
function prepareRow({ raw, mapping, resource, sourceSheet, sourceRowNumber, access, sourceSoftware, branchLookup }) {
  const fields = {};
  for (const [column, field] of Object.entries(mapping)) {
    if (!field || field === "__ignore") continue;
    fields[field] = raw[column];
  }
  const branchId = resolveBranchId(fields, access, branchLookup);
  const sourceExternalId = cleanText(fields.originalRecordId) || `${sourceSheet}:${sourceRowNumber}`;
  const payload = buildPayload(resource, fields, { branchId, sourceSoftware, sourceExternalId });
  return {
    resource,
    entity: resource,
    sourceSheet,
    sourceRowNumber,
    sourceExternalId,
    raw,
    fields,
    payload
  };
}

function buildPayload(resource, fields, { branchId }) {
  const createdAt = dateValue(fields.createdAt || fields.paidAt || fields.startAt) || "";
  if (resource === "clients") {
    return {
      name: cleanText(fields.name),
      phone: normalizePhone(fields.phone),
      email: cleanText(fields.email),
      gender: cleanText(fields.gender),
      birthday: dateValue(fields.birthday),
      anniversary: dateValue(fields.anniversary),
      tags: splitList(fields.tags),
      notes: cleanText(fields.notes),
      walletBalance: 0,
      loyaltyPoints: 0,
      visitCount: 0,
      totalSpend: 0,
      visitHistory: [],
      purchaseHistory: [],
      whatsappHistory: [],
      consentForms: [],
      branchId,
      createdAt: createdAt || undefined
    };
  }
  if (resource === "staff") {
    return {
      name: cleanText(fields.name),
      role: cleanText(fields.role) || "Stylist",
      phone: normalizePhone(fields.phone),
      email: cleanText(fields.email),
      branchId,
      shift: cleanText(fields.shift),
      status: cleanText(fields.status) || "active",
      assignedServices: [],
      commissionRule: {},
      attendance: [],
      performance: {},
      createdAt: createdAt || undefined
    };
  }
  if (resource === "services") {
    return {
      name: cleanText(fields.name || fields.serviceName),
      category: cleanText(fields.category) || "Imported",
      price: money(fields.price),
      durationMinutes: integer(fields.durationMinutes, 30),
      gstRate: numberValue(fields.gstRate, 18),
      status: cleanText(fields.status) || "active",
      assignedStaff: [],
      requiredProducts: [],
      addOns: [],
      packageServices: [],
      createdAt: createdAt || undefined
    };
  }
  if (resource === "products") {
    const name = cleanText(fields.name || fields.productName);
    return {
      name,
      sku: cleanText(fields.sku) || slug(name),
      category: cleanText(fields.category) || "Imported",
      usageType: "retail",
      supplier: cleanText(fields.supplier),
      branchId,
      stock: numberValue(fields.stock, 0),
      lowStockThreshold: numberValue(fields.lowStockThreshold, 5),
      expiryDate: dateOnly(fields.expiryDate),
      unitCost: money(fields.unitCost),
      price: money(fields.price),
      gstRate: numberValue(fields.gstRate, 18),
      status: cleanText(fields.status) || "active",
      createdAt: createdAt || undefined
    };
  }
  if (resource === "inventory") {
    const quantity = numberValue(fields.quantity ?? fields.stock, 0);
    return {
      productId: cleanText(fields.productId),
      productName: cleanText(fields.productName),
      sku: cleanText(fields.sku),
      branchId,
      type: cleanText(fields.type) || (quantity < 0 ? "stock_out" : "import_opening_stock"),
      quantity,
      unitCost: money(fields.unitCost),
      totalCost: quantity * money(fields.unitCost),
      reason: cleanText(fields.reason) || "Imported stock movement",
      referenceType: "migration",
      createdAt: createdAt || undefined
    };
  }
  if (resource === "vendors") {
    return {
      name: cleanText(fields.name || fields.vendor || fields.supplier),
      contactName: cleanText(fields.contactName),
      phone: normalizePhone(fields.phone),
      email: cleanText(fields.email),
      gstin: cleanText(fields.gstin),
      address: cleanText(fields.address),
      status: cleanText(fields.status) || "active",
      createdAt: createdAt || undefined
    };
  }
  if (resource === "expenses") {
    return {
      branchId,
      category: cleanText(fields.category) || "Imported",
      vendor: cleanText(fields.vendor),
      amount: money(fields.amount),
      taxAmount: money(fields.taxAmount),
      paymentMode: cleanText(fields.paymentMode) || "cash",
      paidAt: dateValue(fields.paidAt) || createdAt || now(),
      notes: cleanText(fields.notes),
      status: cleanText(fields.status) || "paid",
      createdAt: createdAt || undefined
    };
  }
  if (resource === "memberships") {
    return {
      clientId: cleanText(fields.clientId),
      clientName: cleanText(fields.clientName || fields.name),
      clientPhone: normalizePhone(fields.clientPhone || fields.phone),
      planName: cleanText(fields.planName) || "Imported membership",
      price: money(fields.price),
      planCredits: integer(fields.planCredits, integer(fields.creditsRemaining, 0)),
      creditsRemaining: integer(fields.creditsRemaining, integer(fields.planCredits, 0)),
      validityDate: dateOnly(fields.validityDate),
      autoRenew: boolValue(fields.autoRenew),
      loyaltyMultiplier: 1,
      status: cleanText(fields.status) || "active",
      serviceCredits: [],
      redeemHistory: [],
      branchId,
      createdAt: createdAt || undefined
    };
  }
  if (resource === "appointments") {
    const blockedTime = isBlockedAppointmentFields(fields);
    return {
      clientId: cleanText(fields.clientId),
      clientName: cleanText(fields.clientName) || (blockedTime ? BLOCKED_TIME_CLIENT_NAME : ""),
      clientPhone: normalizePhone(fields.clientPhone || fields.phone),
      staffId: cleanText(fields.staffId),
      staffName: cleanText(fields.staffName),
      branchId,
      serviceIds: splitList(fields.serviceIds || fields.serviceId),
      serviceName: cleanText(fields.serviceName),
      startAt: dateValue(fields.startAt || fields.createdAt),
      endAt: dateValue(fields.endAt),
      status: cleanText(fields.status) || (blockedTime ? "blocked" : "completed"),
      source: cleanText(fields.source) || "migration",
      chair: cleanText(fields.chair),
      notes: [cleanText(fields.notes), blockedTime ? "Legacy blocked-time appointment" : ""].filter(Boolean).join(" | "),
      blockedTime,
      createdAt: createdAt || undefined
    };
  }
  if (resource === "sales" || resource === "invoices") {
    return {
      saleId: cleanText(fields.saleId),
      invoiceNumber: cleanText(fields.invoiceNumber),
      clientId: cleanText(fields.clientId),
      clientName: cleanText(fields.clientName),
      clientPhone: normalizePhone(fields.clientPhone || fields.phone),
      staffId: cleanText(fields.staffId),
      staffName: cleanText(fields.staffName),
      branchId,
      lineItem: cleanText(fields.lineItem || fields.serviceName || fields.productName) || "Imported sale",
      subtotal: money(fields.subtotal || fields.total),
      discount: money(fields.discount),
      gstAmount: money(fields.gstAmount),
      total: money(fields.total || fields.amount),
      paid: money(fields.paid),
      balance: fields.balance === undefined || fields.balance === "" ? undefined : money(fields.balance),
      paymentMode: cleanText(fields.paymentMode || fields.mode),
      status: cleanText(fields.status) || "completed",
      createdAt: createdAt || undefined
    };
  }
  if (resource === "payments") {
    return {
      invoiceId: cleanText(fields.invoiceId),
      invoiceNumber: cleanText(fields.invoiceNumber),
      mode: cleanText(fields.mode || fields.paymentMode) || "cash",
      amount: money(fields.amount || fields.paid),
      reference: cleanText(fields.reference),
      branchId,
      createdAt: createdAt || undefined
    };
  }
  return {};
}

function resolveMigrationRelations(payload = {}, row = {}, { access = {}, jobId = "" } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const resolved = { ...payload };
  const translate = (resource, value) => translateMigrationId(resource, value, { access, jobId });

  if (["memberships", "appointments", "sales", "invoices"].includes(row.resource)) {
    resolved.clientId = translate("clients", resolved.clientId);
  }
  if (["appointments", "sales", "invoices"].includes(row.resource)) {
    resolved.staffId = translate("staff", resolved.staffId);
  }
  if (row.resource === "appointments") {
    resolved.serviceIds = (Array.isArray(resolved.serviceIds) ? resolved.serviceIds : splitList(resolved.serviceIds))
      .map((id) => translate("services", id))
      .filter(Boolean);
  }
  if (row.resource === "inventory") {
    resolved.productId = translate("products", resolved.productId);
  }
  if (row.resource === "invoices") {
    resolved.saleId = translate("sales", resolved.saleId);
  }
  if (row.resource === "payments") {
    resolved.invoiceId = translate("invoices", resolved.invoiceId || resolved.invoiceNumber);
  }
  return resolved;
}

function translateMigrationId(resource, value, { access = {}, jobId = "" } = {}) {
  const sourceExternalId = cleanText(value);
  if (!sourceExternalId || !access.tenantId) return sourceExternalId;
  const mapped = findMigrationTargetId(resource, sourceExternalId, { access, jobId });
  return mapped || sourceExternalId;
}

function findMigrationTargetId(resource, sourceExternalId, { access = {}, jobId = "" } = {}) {
  try {
    const params = {
      tenantId: access.tenantId,
      jobId: cleanText(jobId),
      resource,
      sourceExternalId
    };
    if (params.jobId) {
      const scoped = db.prepare(`
        SELECT targetId FROM migration_id_map
        WHERE tenantId = @tenantId AND jobId = @jobId AND resource = @resource AND sourceExternalId = @sourceExternalId
        ORDER BY updatedAt DESC LIMIT 1
      `).get(params);
      if (scoped?.targetId) return scoped.targetId;
    }
    return db.prepare(`
      SELECT targetId FROM migration_id_map
      WHERE tenantId = @tenantId AND resource = @resource AND sourceExternalId = @sourceExternalId
      ORDER BY updatedAt DESC LIMIT 1
    `).get(params)?.targetId || "";
  } catch {
    return "";
  }
}
function validatePreparedRow(row, context, seen) {
  const errors = [];
  const warnings = [];
  const payload = row.payload;
  const template = RESOURCE_TEMPLATES[row.resource];
  for (const required of template.required) {
    if (required === "branchId" && payload.branchId) continue;
    if (required === "clientId" && (payload.clientId || payload.clientPhone || payload.clientName)) continue;
    if (required === "staffId" && (payload.staffId || payload.staffName)) continue;
    if (required === "productId" && (payload.productId || payload.productName || payload.sku)) continue;
    if (required === "invoiceId" && (payload.invoiceId || payload.invoiceNumber)) continue;
    // Legacy salon clients frequently have a name but no recorded phone. Blocking
    // them drops real historical customers (and cascades to their visits/sales).
    // Import the client and flag phone as a warning to backfill later, matching
    // how the system already auto-creates phone-less clients from history.
    if (required === "phone" && row.resource === "clients" && !empty(payload.name)) {
      if (empty(payload.phone)) warnings.push("phone missing; client imported for backfill");
      continue;
    }
    if (empty(payload[required])) errors.push(`${required} is required`);
  }
  if (payload.branchId?.startsWith?.(UNMAPPED_BRANCH_PREFIX)) errors.push(`Unmapped branch value ${unmappedBranchName(payload.branchId)}`);
  else if (payload.branchId && !context.branches.some((branch) => branch.id === payload.branchId)) errors.push(`Unknown branchId ${payload.branchId}`);
  const duplicate = duplicateFor(row, context, seen);
  if (duplicate) warnings.push(`Possible duplicate: ${duplicate}`);
  validateReferences(row, context, warnings, errors);
  if (errors.length) return { status: "error", errors, warnings, message: errors.join(", "), duplicate: Boolean(duplicate) };
  if (warnings.length) return { status: "warning", errors, warnings, message: warnings.join(", "), duplicate: Boolean(duplicate) };
  return { status: "valid", errors, warnings, message: "Ready to import", duplicate: false };
}

function validateReferences(row, context, warnings, errors) {
  const payload = row.payload;
  if (["appointments", "sales", "invoices", "memberships"].includes(row.resource) && !resolveClient(payload, context)) {
    if (payload.clientName || payload.clientPhone || payload.blockedTime) warnings.push("Client will be auto-created from migrated history");
    else errors.push("Client reference could not be resolved");
  }
  if (row.resource === "appointments" && !resolveStaff(payload, context)) {
    if (payload.staffName || payload.staffId) warnings.push("Staff will be auto-created from migrated history");
    else errors.push("Staff reference could not be resolved");
  }
  if (row.resource === "inventory") {
    if (!resolveProduct(payload, context)) errors.push("Product reference could not be resolved");
    if (Number(payload.quantity || 0) < 0) warnings.push("Negative inventory movement imported as stock-out history");
  }
  if (row.resource === "payments" && !resolveInvoice(payload, context)) errors.push("Invoice reference could not be resolved");
}

function duplicateFor(row, context, seen) {
  const payload = row.payload;
  const fileKey = `${row.resource}:${cleanText(row.sourceExternalId || payload.invoiceNumber || payload.phone || payload.sku || payload.name).toLowerCase()}`;
  if (seen.has(fileKey)) return "duplicate row in uploaded file";
  seen.add(fileKey);
  const liveContext = { ...context, clients: liveOnly(context.clients), staff: liveOnly(context.staff), services: liveOnly(context.services), products: liveOnly(context.products), invoices: liveOnly(context.invoices) };
  if (row.resource === "clients" && findClient({ ...payload, sourceExternalId: row.sourceExternalId }, liveContext, { strongOnly: true })) return "client already exists";
  if (row.resource === "staff" && liveContext.staff.some((item) => (payload.phone && normalizePhone(item.phone) === payload.phone) || (payload.email && same(item.email, payload.email)))) return "staff already exists";
  if (row.resource === "services" && liveContext.services.some((item) => same(item.name, payload.name))) return "service already exists";
  if (row.resource === "products" && liveContext.products.some((item) => same(item.sku, payload.sku) && item.branchId === payload.branchId)) return "product SKU already exists in branch";
  if (row.resource === "vendors" && context.vendors.some((item) => same(item.name, payload.name))) return "vendor already exists";
  if (row.resource === "invoices" && liveContext.invoices.some((item) => same(item.invoiceNumber, payload.invoiceNumber))) return "invoice number already exists";
  return "";
}

function importPreviewRows(preview, options) {
  const context = createContext(options.access);
  const counters = { importedRows: 0, skippedRows: 0, warningRows: 0, errorRows: 0, byResource: {} };
  for (const row of dependencyOrderedRows(preview.allRows || preview.rows)) {
    const resourceCounter = counters.byResource[row.resource] || { imported: 0, skipped: 0, warnings: 0, errors: 0 };
    let result = { action: "skipped", targetId: "", status: row.status, message: row.message };
    if (row.status === "error") {
      counters.errorRows++;
      resourceCounter.errors++;
      if (options.allowPartialImport === true) {
        counters.skippedRows++;
        resourceCounter.skipped++;
        result = { action: "skipped", targetId: "", status: "error", message: row.message || "Critical row skipped by partial import" };
      }
    } else {
      try {
        const rowImportTx = db.transaction(() => importOne(row, { ...options, context }));
        result = rowImportTx();
        if (result.action === "skipped" || result.action === "merged") {
          counters.skippedRows++;
          resourceCounter.skipped++;
          counters.warningRows++;
          resourceCounter.warnings++;
        } else {
          counters.importedRows++;
          resourceCounter.imported++;
          if (row.status === "warning") {
            counters.warningRows++;
            resourceCounter.warnings++;
          }
        }
      } catch (error) {
        result = { action: "failed", targetId: "", status: "error", message: error.message };
        counters.errorRows++;
        resourceCounter.errors++;
      }
    }
    counters.byResource[row.resource] = resourceCounter;
    recordMigrationIdMap(row, result, options);
    insertMigrationRow("migration_row_results", {
      id: makeIdLong("migres"),
      tenantId: options.access.tenantId,
      jobId: options.jobId,
      batchId: options.batchId,
      resource: row.resource,
      entity: row.resource,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      sourceExternalId: row.sourceExternalId,
      action: result.action,
      targetId: result.targetId,
      status: result.status,
      message: result.message,
      payload: row.payload,
      raw: row.raw,
      errors: row.errors || [],
      warnings: row.warnings || []
    });
  }
  return counters;
}

function importOne(row, { access, batchId, sourceSoftware, migrationMode, context, duplicateDecisions = {}, jobId = "" }) {
  const payload = resolveMigrationRelations(row.payload, row, { access, jobId });
  const meta = { ...(migrationMode ? migrationMeta(row, batchId, sourceSoftware) : {}), tenantId: access.tenantId };
  if (row.resource === "clients") {
    const existing = findClient({ ...payload, sourceExternalId: row.sourceExternalId }, context, { strongOnly: true });
    if (existing) {
      const decision = duplicateDecisionFor(row, duplicateDecisions);
      if (decision === "keep") {
        const created = insertRow("clients", { ...payload, ...meta, notes: [payload.notes, `Kept separate during migration from ${existing.id}`].filter(Boolean).join(" | ") });
        context.clients.push(created);
        indexClientRecord(context, created);
        return { action: "created", targetId: created.id, status: "warning", message: "Duplicate client kept as separate record" };
      }
      if (decision === "merge") {
        const updated = mergeImportedClient(existing, payload, meta, access);
        Object.assign(existing, updated);
        indexClientRecord(context, existing);
        return { action: "merged", targetId: existing.id, status: "warning", message: "Client merged with existing record" };
      }
      if (decision === "link") {
        return { action: "linked", targetId: existing.id, status: "warning", message: "Client linked to existing record" };
      }
      return { action: "skipped", targetId: existing.id, status: "warning", message: "Client already exists" };
    }
    const created = insertRow("clients", { ...payload, ...meta });
    context.clients.push(created);
    indexClientRecord(context, created);
    return { action: "created", targetId: created.id, status: row.status, message: "Client imported" };
  }
  if (row.resource === "staff") {
    const existing = context.staff.find((item) => (payload.phone && normalizePhone(item.phone) === payload.phone) || same(item.email, payload.email));
    if (existing) return { action: "skipped", targetId: existing.id, status: "warning", message: "Staff already exists" };
    const created = insertRow("staff", { ...payload, ...meta });
    context.staff.push(created);
    indexStaffRecord(context, created);
    return { action: "created", targetId: created.id, status: row.status, message: "Staff imported" };
  }
  if (row.resource === "services") {
    const existing = context.services.find((item) => same(item.name, payload.name));
    if (existing) return { action: "skipped", targetId: existing.id, status: "warning", message: "Service already exists" };
    const created = insertRow("services", { ...payload, ...meta });
    context.services.push(created);
    indexServiceRecord(context, created);
    return { action: "created", targetId: created.id, status: row.status, message: "Service imported" };
  }
  if (row.resource === "products") {
    const existing = context.products.find((item) => same(item.sku, payload.sku) && item.branchId === payload.branchId);
    if (existing) return { action: "skipped", targetId: existing.id, status: "warning", message: "Product already exists" };
    const created = insertRow("products", { ...payload, ...meta });
    context.products.push(created);
    indexProductRecord(context, created);
    return { action: "created", targetId: created.id, status: row.status, message: "Product imported" };
  }
  if (row.resource === "inventory") {
    const product = resolveProduct(payload, context);
    const created = insertRow("inventory_transactions", {
      productId: product.id,
      branchId: payload.branchId || product.branchId,
      type: payload.type,
      quantity: payload.quantity,
      unitCost: payload.unitCost,
      totalCost: payload.totalCost,
      reason: payload.reason,
      referenceType: "migration",
      referenceId: batchId,
      createdAt: payload.createdAt,
      ...meta
    });
    updateRow("products", product.id, { stock: Number(product.stock || 0) + Number(payload.quantity || 0) }, { tenantId: access.tenantId });
    product.stock = Number(product.stock || 0) + Number(payload.quantity || 0);
    return { action: "created", targetId: created.id, status: row.status, message: "Inventory movement imported" };
  }
  if (row.resource === "vendors") {
    const existing = context.vendors.find((item) => same(item.name, payload.name));
    if (existing) return { action: "skipped", targetId: existing.id, status: "warning", message: "Vendor already exists" };
    const created = insertRow("suppliers", { ...payload, ...meta });
    context.vendors.push(created);
    return { action: "created", targetId: created.id, status: row.status, message: "Vendor imported" };
  }
  if (row.resource === "expenses") {
    const created = insertRow("finance_expenses", { ...payload, ...meta });
    postMigrationExpenseJournal(created, payload, access, meta);
    return { action: "created", targetId: created.id, status: row.status, message: "Expense imported" };
  }
  if (row.resource === "memberships") {
    const client = ensureClient(payload, context, access, meta);
    const created = insertRow("memberships", { ...payload, clientId: client.id, ...meta });
    updateRow("clients", client.id, { membershipId: created.id }, { tenantId: access.tenantId });
    return { action: "created", targetId: created.id, status: row.status, message: "Membership imported" };
  }
  if (row.resource === "appointments") {
    const client = ensureClient(payload, context, access, meta);
    const staff = ensureStaff(payload, context, access, meta);
    const serviceIds = resolveServiceIds(payload, context);
    const startAt = payload.startAt || now();
    const created = insertRow("appointments", {
      ...payload,
      clientId: client.id,
      staffId: staff.id,
      serviceIds,
      startAt,
      endAt: payload.endAt || new Date(new Date(startAt).getTime() + 30 * 60000).toISOString(),
      ...meta
    });
    return { action: "created", targetId: created.id, status: row.status, message: "Appointment imported" };
  }
  if (row.resource === "sales") {
    const sale = createImportedSale(payload, context, access, meta);
    postMigrationSaleJournal(sale, payload, row, context, access, meta);
    return { action: "created", targetId: sale.id, status: row.status, message: "Sale imported" };
  }
  if (row.resource === "invoices") {
    const invoice = createImportedInvoice(payload, context, access, meta);
    postMigrationInvoiceJournal(invoice, payload, context, access, meta);
    return { action: "created", targetId: invoice.id, status: row.status, message: "Invoice imported" };
  }
  if (row.resource === "payments") {
    const invoice = resolveInvoice(payload, context);
    const created = insertRow("payments", {
      invoiceId: invoice.id,
      branchId: payload.branchId || invoice.branchId || "",
      mode: payload.mode,
      amount: payload.amount,
      reference: payload.reference,
      createdAt: payload.createdAt,
      ...meta
    });
    const paid = Number(invoice.paid || 0) + Number(payload.amount || 0);
    const balance = Math.max(0, Number(invoice.total || 0) - paid);
    const updated = updateRow("invoices", invoice.id, { paid, balance, status: balance <= 0 ? "paid" : "partial" }, { tenantId: access.tenantId });
    Object.assign(invoice, updated);
    postMigrationPaymentJournal(created, invoice, payload, access, meta);
    return { action: "created", targetId: created.id, status: row.status, message: "Payment imported" };
  }
  return { action: "skipped", targetId: "", status: "warning", message: "Unsupported resource" };
}

function createImportedSale(payload, context, access, meta) {
  const client = ensureClient(payload, context, access, meta);
  const staff = resolveStaff(payload, context);
  const total = money(payload.total);
  const sale = insertRow("sales", {
    clientId: client.id,
    branchId: payload.branchId,
    staffId: staff?.id || payload.staffId || "",
    items: [{ type: "imported", name: payload.lineItem || "Imported sale", quantity: 1, price: total, gstRate: 0 }],
    subtotal: money(payload.subtotal || total),
    discount: money(payload.discount),
    gstAmount: money(payload.gstAmount),
    total,
    status: payload.status || "completed",
    createdAt: payload.createdAt,
    ...meta
  });
  context.sales.push(sale);
  updateClientHistory(client, sale, access);
  return sale;
}

function createImportedInvoice(payload, context, access, meta) {
  const sale = payload.saleId ? context.sales.find((item) => item.id === payload.saleId) : createImportedSale(payload, context, access, meta);
  const paid = payload.balance === undefined ? money(payload.paid) : Math.max(0, money(payload.total) - money(payload.balance));
  const balance = payload.balance === undefined ? Math.max(0, money(payload.total) - paid) : money(payload.balance);
  const invoiceNumber = uniqueInvoiceNumberForImport(payload, context, access, meta, sale);
  const invoice = insertRow("invoices", {
    saleId: sale.id,
    clientId: sale.clientId,
    invoiceNumber,
    branchId: payload.branchId || sale.branchId,
    staffId: payload.staffId || sale.staffId || "",
    lineItems: sale.items,
    subtotal: money(payload.subtotal || sale.subtotal),
    discount: money(payload.discount),
    gstAmount: money(payload.gstAmount),
    total: money(payload.total || sale.total),
    paid,
    balance,
    status: payload.status || (balance <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid"),
    createdAt: payload.createdAt,
    ...meta
  });
  context.invoices.push(invoice);
  indexInvoiceRecord(context, invoice);
  return invoice;
}

const MIGRATION_PAYMENT_ASSET_CODES = {
  cash: "1000",
  bank: "1010",
  card: "1010",
  credit_card: "1010",
  debit_card: "1010",
  upi: "1010",
  cheque: "1010",
  check: "1010",
  neft: "1010",
  rtgs: "1010",
  imps: "1010",
  wallet: "1010",
  online: "1010",
  razorpay: "1010",
  stripe: "1010",
  paytm: "1010",
  phonepe: "1010",
  google_pay: "1010",
  gpay: "1010"
};

const MIGRATION_EXPENSE_ACCOUNT_CODES = {
  salary: "5100",
  staff_salary: "5100",
  commission: "5100",
  staff_commission: "5100",
  rent: "5200",
  marketing: "5300",
  utilities: "5300",
  software_subscription: "5300",
  communication: "5300",
  repair_maintenance: "5300",
  cleaning_housekeeping: "5300",
  bank_charges: "5300",
  professional_legal: "5300",
  other: "5300",
  imported: "5300",
  cogs: "5000",
  product: "5000",
  product_consumable: "5000",
  wastage_damage: "5000",
  inventory_purchase: "1200",
  fixed_asset_purchase: "1500",
  security_deposit: "1100",
  prepaid_expense: "1100",
  advance: "1100",
  gst_payment: "2100",
  statutory_payment: "2100",
  bank_deposit: "1010",
  loan: "2200",
  interest: "5300",
  owner_drawing: "3100",
  depreciation: "5400",
  client_refreshment: "5300",
  uniform: "5300",
  stationery: "5300",
  travel: "5300",
  training: "5300"
};

const MIGRATION_LEDGER_SOURCE_TYPES_BY_TABLE = {
  payments: ["migration.payment.received"],
  invoices: ["migration.invoice.receivable", "migration.invoice.settlement"],
  sales: ["migration.sale.recorded"],
  finance_expenses: ["migration.expense.recorded"]
};

function postMigrationExpenseJournal(expense, payload, access, meta) {
  const amountPaise = amountToPaise(expense.amount);
  if (amountPaise <= 0) return null;
  const inputGstPaise = Math.min(amountPaise, Math.max(0, amountToPaise(expense.taxAmount ?? payload.taxAmount)));
  const expensePaise = amountPaise - inputGstPaise;
  return postMigrationJournal({
    branchId: ledgerBranchId(expense, payload, access),
    businessDate: migrationBusinessDate(payload.paidAt, expense.paidAt, payload.createdAt, expense.createdAt),
    sourceType: "migration.expense.recorded",
    sourceId: expense.id,
    memo: "Migration expense " + (expense.category || payload.category || "import"),
    lines: [
      ...(expensePaise > 0 ? [{ code: expenseAccountCode(expense.category || payload.category), debitPaise: expensePaise }] : []),
      ...(inputGstPaise > 0 ? [{ code: "2100", debitPaise: inputGstPaise, memo: "Input GST credit" }] : []),
      { code: paymentAssetCode(expense.paymentMode || payload.paymentMode || payload.mode), creditPaise: amountPaise }
    ]
  }, access, meta);
}

function postMigrationSaleJournal(sale, payload, row, context, access, meta) {
  if (hasPendingInvoiceForSale(context, row, sale, payload)) return null;
  const amountPaise = amountToPaise(sale.total || payload.total);
  if (amountPaise <= 0) return null;
  const taxPaise = Math.min(amountPaise, Math.max(0, amountToPaise(sale.gstAmount ?? payload.gstAmount)));
  const revenuePaise = amountPaise - taxPaise;
  const statusKey = cleanKey(sale.status || payload.status);
  const debitCode = ["unpaid", "pending", "open", "due"].includes(statusKey) ? "1100" : paymentAssetCode(payload.paymentMode || payload.mode);
  return postMigrationJournal({
    branchId: ledgerBranchId(sale, payload, access),
    businessDate: migrationBusinessDate(payload.createdAt, sale.createdAt),
    sourceType: "migration.sale.recorded",
    sourceId: sale.id,
    memo: "Migration sale " + (payload.lineItem || sale.id),
    lines: [
      { code: debitCode, debitPaise: amountPaise },
      ...(revenuePaise > 0 ? [{ code: "4000", creditPaise: revenuePaise }] : []),
      ...(taxPaise > 0 ? [{ code: "2100", creditPaise: taxPaise }] : [])
    ]
  }, access, meta);
}

function postMigrationInvoiceJournal(invoice, payload, context, access, meta) {
  const amountPaise = amountToPaise(invoice.total || payload.total);
  if (amountPaise <= 0) return null;
  const taxPaise = Math.min(amountPaise, Math.max(0, amountToPaise(invoice.gstAmount ?? payload.gstAmount)));
  const revenuePaise = amountPaise - taxPaise;
  const branchId = ledgerBranchId(invoice, payload, access);
  const businessDate = migrationBusinessDate(payload.createdAt, invoice.createdAt);
  const receivable = postMigrationJournal({
    branchId,
    businessDate,
    sourceType: "migration.invoice.receivable",
    sourceId: invoice.id,
    memo: "Migration invoice " + (invoice.invoiceNumber || invoice.id),
    lines: [
      { code: "1100", debitPaise: amountPaise },
      ...(revenuePaise > 0 ? [{ code: "4000", creditPaise: revenuePaise }] : []),
      ...(taxPaise > 0 ? [{ code: "2100", creditPaise: taxPaise }] : [])
    ]
  }, access, meta);
  const paidPaise = Math.min(amountPaise, Math.max(0, amountToPaise(invoice.paid ?? payload.paid)));
  if (paidPaise > 0 && !hasPendingPaymentForInvoice(context, payload, invoice)) {
    postMigrationJournal({
      branchId,
      businessDate,
      sourceType: "migration.invoice.settlement",
      sourceId: invoice.id,
      memo: "Migration invoice opening settlement " + (invoice.invoiceNumber || invoice.id),
      lines: [
        { code: paymentAssetCode(payload.paymentMode || payload.mode), debitPaise: paidPaise },
        { code: "1100", creditPaise: paidPaise }
      ]
    }, access, meta);
  }
  return receivable;
}

function postMigrationPaymentJournal(payment, invoice, payload, access, meta) {
  const amountPaise = amountToPaise(payment.amount || payload.amount);
  if (amountPaise <= 0) return null;
  return postMigrationJournal({
    branchId: ledgerBranchId(payment, { ...payload, branchId: payload.branchId || invoice.branchId }, access),
    businessDate: migrationBusinessDate(payload.createdAt, payment.createdAt, invoice.createdAt),
    sourceType: "migration.payment.received",
    sourceId: payment.id,
    memo: "Migration payment " + (payment.reference || invoice.invoiceNumber || payment.id),
    lines: [
      { code: paymentAssetCode(payment.mode || payload.mode || payload.paymentMode), debitPaise: amountPaise },
      { code: "1100", creditPaise: amountPaise }
    ]
  }, access, meta);
}

function postMigrationJournal(entry, access, meta) {
  if (!shouldPostMigrationLedger(meta)) return null;
  const branchId = cleanText(entry.branchId || access.branchId || access.branchIds?.[0]);
  if (!branchId) throw badRequest("Branch is required for migration ledger posting.");
  const sourceId = cleanText(entry.sourceId);
  if (!sourceId) throw badRequest("Source id is required for migration ledger posting.");
  const lines = (entry.lines || [])
    .map((line) => ({
      ...line,
      debitPaise: Math.max(0, Math.round(Number(line.debitPaise || 0))),
      creditPaise: Math.max(0, Math.round(Number(line.creditPaise || 0)))
    }))
    .filter((line) => line.debitPaise > 0 || line.creditPaise > 0);
  const debitTotal = lines.reduce((sum, line) => sum + line.debitPaise, 0);
  const creditTotal = lines.reduce((sum, line) => sum + line.creditPaise, 0);
  if (debitTotal <= 0) return null;
  if (lines.length < 2 || debitTotal !== creditTotal) throw badRequest("Migration journal entry must balance before posting.");
  const ledgerAccess = migrationLedgerAccess(access, branchId);
  const accounts = new Map(balanceSheetService.accounts({ branchId }, ledgerAccess).map((account) => [account.code, account]));
  const mappedLines = lines.map((line) => {
    const account = accounts.get(line.code);
    if (!account) throw badRequest("Ledger account " + line.code + " is not configured for branch " + branchId + ".");
    return {
      accountId: account.id,
      debitPaise: line.debitPaise,
      creditPaise: line.creditPaise,
      memo: line.memo || entry.memo || ""
    };
  });
  return balanceSheetService.createJournal({
    branchId,
    businessDate: entry.businessDate || undefined,
    sourceType: entry.sourceType,
    sourceId,
    memo: entry.memo || "Migration journal",
    idempotencyKey: ["migration", access.tenantId, branchId, entry.sourceType, sourceId].join(":"),
    lines: mappedLines
  }, ledgerAccess);
}

function reverseMigrationJournalsForImportedRows(table, whereSql, params, access) {
  assertValidTable(table, "reverseMigrationJournalsForImportedRows");
  const sourceTypes = MIGRATION_LEDGER_SOURCE_TYPES_BY_TABLE[table];
  if (!sourceTypes?.length) return;
  const rows = db.prepare(`SELECT id FROM ${table} WHERE ${whereSql}`).all(params);
  for (const row of rows) {
    for (const sourceType of sourceTypes) {
      const entries = db.prepare("SELECT id FROM journalEntries WHERE tenantId = @tenantId AND sourceType = @sourceType AND sourceId = @sourceId AND status = 'posted' ORDER BY createdAt DESC")
        .all({ tenantId: access.tenantId, sourceType, sourceId: row.id });
      for (const entry of entries) {
        balanceSheetService.reverseJournal(entry.id, { reason: "Rollback migration " + table + " " + row.id }, access);
      }
    }
  }
}

function shouldPostMigrationLedger(meta = {}) {
  return Number(meta.imported || 0) === 1;
}

function migrationLedgerAccess(access, branchId) {
  return { ...access, requestedBranchId: branchId };
}

function ledgerBranchId(record = {}, payload = {}, access = {}) {
  return cleanText(record.branchId || payload.branchId || access.branchId || access.branchIds?.[0]);
}

function amountToPaise(value) {
  return Math.round(numberValue(value, 0) * 100);
}

function paymentAssetCode(mode) {
  const key = cleanKey(mode || "bank").replace(/\s+/g, "_");
  return MIGRATION_PAYMENT_ASSET_CODES[key] || "1010";
}

function expenseAccountCode(category) {
  const key = cleanKey(category || "other").replace(/\s+/g, "_");
  return MIGRATION_EXPENSE_ACCOUNT_CODES[key] || "5300";
}

function migrationBusinessDate(...values) {
  for (const value of values) {
    const match = cleanText(value).match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  return "";
}

function referenceKeys(...values) {
  return new Set(values.map((value) => cleanText(value)).filter(Boolean));
}

function hasPendingInvoiceForSale(context, row, sale, payload) {
  const keys = referenceKeys(row?.sourceExternalId, payload?.originalRecordId, sale?.originalRecordId, sale?.id);
  if (!keys.size) return false;
  return (context.pendingRows || []).some((pending) => {
    if (pending.resource !== "invoices") return false;
    const pendingPayload = pending.payload || {};
    return keys.has(cleanText(pendingPayload.saleId));
  });
}

function hasPendingPaymentForInvoice(context, payload, invoice) {
  const keys = referenceKeys(payload?.originalRecordId, payload?.invoiceNumber, invoice?.originalRecordId, invoice?.invoiceNumber, invoice?.id);
  if (!keys.size) return false;
  return (context.pendingRows || []).some((pending) => {
    if (pending.resource !== "payments") return false;
    const pendingPayload = pending.payload || {};
    return keys.has(cleanText(pendingPayload.invoiceId)) || keys.has(cleanText(pendingPayload.invoiceNumber));
  });
}

function rollbackImports(access, filters = {}) {
  const batches = findRollbackBatches(access, filters);
  if (!batches.length) return { ok: false, message: "No active import batch found for rollback.", deleted: {} };
  const deleted = {};
  const batchIds = batches.map((batch) => batch.id);
  const rollbackTx = db.transaction(() => {
    for (const table of rollbackTableOrder(filters.resource)) {
      const count = deleteImportedRows(table, batchIds, access, filters);
      if (count) deleted[table] = count;
    }
    for (const batch of batches) {
      updateMigrationRow("migration_import_batches", batch.id, { status: "rolled_back", rolledBackAt: now() }, { tenantId: access.tenantId });
      if (batch.jobId) updateMigrationRow("migration_jobs", batch.jobId, { status: "rolled_back" }, { tenantId: access.tenantId });
    }
  });
  withBusyRetry(() => rollbackTx());
  auditMigration("migration.rollback.completed", { filters, batchIds, deleted }, access);
  return { ok: true, deleted, batchIds };
}

function migrationJobRecovery(jobId, access) {
  const job = db.prepare("SELECT * FROM migration_jobs WHERE id = @jobId AND tenantId = @tenantId").get({ jobId, tenantId: access.tenantId });
  if (!job) throw badRequest("Migration job not found.");
  const rows = db.prepare(`
    SELECT * FROM migration_row_results
    WHERE tenantId = @tenantId AND jobId = @jobId
    ORDER BY sourceSheet, sourceRowNumber, createdAt
  `).all({ tenantId: access.tenantId, jobId }).map((row) => deserializeJson(row, ["payload", "raw", "errors", "warnings"]));
  const batches = db.prepare(`
    SELECT * FROM migration_import_batches
    WHERE tenantId = @tenantId AND jobId = @jobId
    ORDER BY createdAt DESC
  `).all({ tenantId: access.tenantId, jobId }).map((row) => deserializeJson(row, ["summary", "filters"]));
  const idMapRows = db.prepare(`
    SELECT resource, linkType, COUNT(*) AS rows
    FROM migration_id_map
    WHERE tenantId = @tenantId AND jobId = @jobId
    GROUP BY resource, linkType
  `).all({ tenantId: access.tenantId, jobId });
  const failedRows = rows.filter((row) => row.status === "error" || row.action === "failed").map(recoveryRowSummary);
  const warningRows = rows.filter((row) => row.status === "warning" || row.action === "skipped" || row.action === "merged").map(recoveryRowSummary);
  const missingLiveTargets = rows
    .filter((row) => row.targetId && ["created", "merged", "linked"].includes(row.action) && !migrationTargetExists(row, access))
    .map(recoveryRowSummary);
  const importedRows = rows.filter((row) => row.targetId && ["created", "merged", "linked"].includes(row.action)).length;
  const retryCandidates = failedRows.filter((row) => row.retryable);
  const rollbackBatches = batches.filter((batch) => batch.status !== "rolled_back").map((batch) => ({
    batchId: batch.id,
    status: batch.status,
    resource: batch.resource,
    importedRows: Number(batch.summary?.importedRows || 0),
    errorRows: Number(batch.summary?.errorRows || 0),
    createdAt: batch.createdAt
  }));
  const blockers = [];
  if (failedRows.length) blockers.push("failed_rows_present");
  if (missingLiveTargets.length) blockers.push("missing_live_targets");
  if (batches.some((batch) => batch.status === "importing")) blockers.push("batch_still_importing");
  return {
    job: deserializeJson(job, ["summary", "mapping", "settings"]),
    status: blockers.length ? "attention_required" : "recoverable",
    blockers,
    summary: {
      totalRows: rows.length,
      importedRows,
      failedRows: failedRows.length,
      warningRows: warningRows.length,
      retryCandidates: retryCandidates.length,
      missingLiveTargets: missingLiveTargets.length,
      batches: batches.length
    },
    failedRows: failedRows.slice(0, 500),
    warningRows: warningRows.slice(0, 500),
    retryCandidates: retryCandidates.slice(0, 500),
    rollbackPlan: {
      recommended: Boolean(importedRows && (failedRows.length || missingLiveTargets.length)),
      batches: rollbackBatches,
      endpoint: `/migration/jobs/${jobId}/rollback`
    },
    idMapCoverage: rowsByPair(idMapRows, "resource", "linkType"),
    missingLiveTargets: missingLiveTargets.slice(0, 500),
    nextActions: recoveryNextActions({ failedRows, missingLiveTargets, rollbackBatches })
  };
}

function recoveryRowSummary(row) {
  const errors = Array.isArray(row.errors) ? row.errors : [];
  const warnings = Array.isArray(row.warnings) ? row.warnings : [];
  const message = cleanText(row.message || errors.join(", ") || warnings.join(", "));
  const retryable = row.action === "failed" || row.status === "error";
  return {
    rowKey: `${row.sourceSheet}:${row.sourceRowNumber}`,
    resource: row.resource,
    sourceSheet: row.sourceSheet,
    sourceRowNumber: row.sourceRowNumber,
    sourceExternalId: row.sourceExternalId,
    action: row.action,
    status: row.status,
    targetId: row.targetId,
    message,
    errors,
    warnings,
    retryable,
    retryReason: retryable ? recoveryRetryReason(message) : "manual_review"
  };
}

function recoveryRetryReason(message = "") {
  if (/reference|could not be resolved|unknown/i.test(message)) return "fix_parent_mapping_then_retry";
  if (/duplicate|already/i.test(message)) return "choose_duplicate_decision";
  if (/required|invalid|date|amount|phone|email/i.test(message)) return "fix_source_row_then_retry";
  return "inspect_row_error";
}

function migrationTargetExists(row, access) {
  const table = RESOURCE_TEMPLATES[row.resource]?.table;
  if (!table || !row.targetId) return false;
  try {
    const columns = new Set(columnsFor(table));
    const tenantSql = columns.has("tenantId") ? " AND tenantId = @tenantId" : "";
    return Boolean(db.prepare(`SELECT id FROM ${table} WHERE id = @id${tenantSql} LIMIT 1`).get({ id: row.targetId, tenantId: access.tenantId }));
  } catch {
    return false;
  }
}

function recoveryNextActions({ failedRows, missingLiveTargets, rollbackBatches }) {
  if (missingLiveTargets.length) return ["Run rollback for affected batch", "Re-run analyze after checking live target tables", "Import again after proof check passes"];
  if (failedRows.length) return ["Download failed row report", "Fix source rows or parent mappings", "Re-run analyze", "Import corrected rows only"];
  if (rollbackBatches.length) return ["Run reconciliation proof", "Export proof report", "Mark migration complete"];
  return ["No recovery action needed"];
}
function findRollbackBatches(access, filters) {
  const where = ["tenantId = @tenantId", "status <> 'rolled_back'", "rolledBackAt = ''"];
  const params = { tenantId: access.tenantId };
  if (filters.jobId) {
    where.push("jobId = @jobId");
    params.jobId = filters.jobId;
  }
  if (filters.batchId) {
    where.push("id = @batchId");
    params.batchId = filters.batchId;
  }
  if (filters.branchId) {
    where.push("(branchId = @branchId OR branchId = '')");
    params.branchId = filters.branchId;
  }
  if (filters.resource) {
    where.push("(resource = @resource OR resource = 'auto')");
    params.resource = canonicalResource(filters.resource);
  }
  return db.prepare(`SELECT * FROM migration_import_batches WHERE ${where.join(" AND ")} ORDER BY createdAt DESC`).all(params);
}

function deleteImportedRows(table, batchIds, access, filters) {
  assertValidTable(table, "deleteImportedRows");
  const columns = columnsFor(table);
  if (!columns.includes("imported") || !columns.includes("importBatchId")) {
    return 0;
  }
  const placeholders = batchIds.map((_, index) => `@batch${index}`).join(",");
  const params = Object.fromEntries(batchIds.map((id, index) => [`batch${index}`, id]));
  params.tenantId = access.tenantId;
  const tenantColumn = columns.includes("tenantId") ? "tenantId" : columns.includes("tenant_id") ? "tenant_id" : "";
  const where = ["imported = 1", `importBatchId IN (${placeholders})`];
  if (tenantColumn) {
    where.unshift(`${tenantColumn} = @tenantId`);
  }
  if (filters.branchId && tableHasBranch(table) && columns.includes("branchId")) {
    where.push("branchId = @branchId");
    params.branchId = filters.branchId;
  }
  const whereSql = where.join(" AND ");
  reverseMigrationJournalsForImportedRows(table, whereSql, params, access);
  if (table === "inventory_transactions") reverseImportedInventoryTransactions(whereSql, params, access);
  if (table === "sales") reverseImportedClientSales(whereSql, params, access);
  const result = db.prepare(`DELETE FROM ${table} WHERE ${whereSql}`).run(params);
  return result.changes || 0;
}

function reverseImportedInventoryTransactions(whereSql, params, access) {
  const rows = db.prepare(`SELECT productId, quantity FROM inventory_transactions WHERE ${whereSql}`).all(params);
  for (const row of rows) {
    if (!row.productId) continue;
    const product = db.prepare("SELECT id, stock FROM products WHERE id = @id AND tenantId = @tenantId").get({ id: row.productId, tenantId: access.tenantId });
    if (!product) continue;
    updateRow("products", product.id, { stock: Number(product.stock || 0) - Number(row.quantity || 0) }, { tenantId: access.tenantId });
  }
}

function reverseImportedClientSales(whereSql, params, access) {
  const rows = db.prepare(`SELECT clientId, COUNT(*) AS visits, SUM(total) AS total FROM sales WHERE ${whereSql} AND COALESCE(clientId, '') <> '' GROUP BY clientId`).all(params);
  for (const row of rows) {
    const client = db.prepare("SELECT id, totalSpend, visitCount FROM clients WHERE id = @id").get({ id: row.clientId });
    if (!client) continue;
    updateRow("clients", client.id, {
      totalSpend: Math.max(0, Number(client.totalSpend || 0) - Number(row.total || 0)),
      visitCount: Math.max(0, Number(client.visitCount || 0) - Number(row.visits || 0))
    }, { tenantId: access.tenantId });
  }
}

function rollbackTableOrder(resource = "") {
  const map = {
    clients: ["clients"],
    staff: ["staff"],
    services: ["services"],
    products: ["inventory_transactions", "products"],
    inventory: ["inventory_transactions"],
    vendors: ["suppliers"],
    expenses: ["finance_expenses"],
    memberships: ["memberships"],
    appointments: ["appointments"],
    sales: ["payments", "invoices", "sales"],
    invoices: ["payments", "invoices", "sales"],
    payments: ["payments"]
  };
  const canonical = canonicalResource(resource);
  return canonical ? map[canonical] || [] : ["payments", "invoices", "sales", "appointments", "memberships", "inventory_transactions", "products", "services", "staff", "finance_expenses", "suppliers", "clients"];
}

function tableHasBranch(table) {
  return !["services", "suppliers"].includes(table);
}

function createContext(access, pendingRows = []) {
  const scope = { tenantId: access.tenantId, limit: 100000 };
  const branches = listRows("branches", scope);
  const clients = listRows("clients", scope);
  const staff = listRows("staff", scope);
  const services = listRows("services", scope);
  const products = listRows("products", scope);
  const vendors = listRows("suppliers", scope);
  const invoices = listRows("invoices", scope);
  const sales = listRows("sales", scope);
  addPendingDependencyReferences({ clients, staff, services, products, invoices, sales }, pendingRows);
  const context = { access, branches, clients, staff, services, products, vendors, invoices, sales, pendingRows };
  context.clientIndex = { id: new Map(), original: new Map(), phone: new Map(), email: new Map(), name: new Map() };
  context.staffIndex = { id: new Map(), original: new Map(), name: new Map(), email: new Map(), phone: new Map() };
  context.productIndex = { id: new Map(), original: new Map(), sku: new Map(), name: new Map() };
  context.invoiceIndex = { id: new Map(), original: new Map(), number: new Map() };
  context.serviceIndex = { id: new Map(), name: new Map() };
  for (const client of clients) indexClientRecord(context, client);
  for (const staffRow of staff) indexStaffRecord(context, staffRow);
  for (const product of products) indexProductRecord(context, product);
  for (const invoice of invoices) indexInvoiceRecord(context, invoice);
  for (const service of services) indexServiceRecord(context, service);
  return context;
}

const STAGED_REFERENCE_RESOURCES = ["clients", "staff", "services", "products", "invoices", "sales"];

// Loads a large job's already-staged dependency rows so cross-chunk references
// can be resolved during per-chunk analysis. Returns lightweight pending-row
// shapes ({ resource, sourceExternalId, payload }) consumed by
// addPendingDependencyReferences. Rows already imported/rolled back/cancelled
// are excluded; status is otherwise irrelevant because references auto-create
// from migrated history at import time.
function loadJobStagedReferenceRows(jobId, access) {
  const cleanJobId = cleanText(jobId);
  if (!cleanJobId) return [];
  const placeholders = STAGED_REFERENCE_RESOURCES.map(() => "?").join(", ");
  let rows;
  try {
    rows = db.prepare(`
      SELECT resource, sourceExternalId, payload
        FROM migration_staging_rows
       WHERE tenantId = ?
         AND jobId = ?
         AND resource IN (${placeholders})
         AND status NOT IN ('imported', 'rolled_back', 'cancelled')
    `).all(access.tenantId, cleanJobId, ...STAGED_REFERENCE_RESOURCES);
  } catch {
    return [];
  }
  return rows.map((row) => ({
    resource: row.resource,
    sourceExternalId: row.sourceExternalId,
    payload: parseJsonField(row.payload, {})
  }));
}

function addPendingDependencyReferences(context, pendingRows = []) {
  for (const row of pendingRows || []) {
    const payload = row.payload || {};
    const sourceExternalId = cleanText(row.sourceExternalId);
    if (!sourceExternalId) continue;
    if (row.resource === "clients") {
      context.clients.push({ ...payload, id: sourceExternalId, originalRecordId: sourceExternalId, pending: true });
    } else if (row.resource === "staff") {
      context.staff.push({ ...payload, id: sourceExternalId, originalRecordId: sourceExternalId, pending: true });
    } else if (row.resource === "services") {
      context.services.push({ ...payload, id: sourceExternalId, originalRecordId: sourceExternalId, pending: true });
    } else if (row.resource === "products") {
      context.products.push({ ...payload, id: sourceExternalId, originalRecordId: sourceExternalId, pending: true });
    } else if (row.resource === "sales") {
      context.sales.push({ ...payload, id: sourceExternalId, originalRecordId: sourceExternalId, pending: true });
    } else if (row.resource === "invoices") {
      context.invoices.push({ ...payload, id: sourceExternalId || payload.invoiceNumber, originalRecordId: sourceExternalId, pending: true });
    }
  }
}

function liveOnly(rows = []) {
  return rows.filter((row) => !row.pending);
}
function buildBranchLookup(access = {}) {
  const branches = listRows("branches", { tenantId: access.tenantId, limit: 1000 });
  const byId = new Set(branches.map((branch) => cleanText(branch.id)).filter(Boolean));
  const byName = new Map();
  for (const branch of branches) {
    for (const value of [branch.id, branch.name, branch.city]) {
      const key = cleanKey(value);
      if (key && !byName.has(key)) byName.set(key, branch.id);
    }
  }
  return { branches, byId, byName };
}

function resolveBranchId(fields, access, branchLookup = null) {
  const explicit = cleanText(fields.branchId);
  const branchName = cleanText(fields.branchName);
  const lookup = branchLookup || buildBranchLookup(access);
  if (explicit) {
    if (lookup.byId.has(explicit)) return explicit;
    const explicitBranchId = lookup.byName.get(cleanKey(explicit)) || sourceBranchAlias(explicit, lookup);
    if (explicitBranchId) return explicitBranchId;
    return UNMAPPED_BRANCH_PREFIX + explicit;
  }
  if (branchName) {
    const branchId = lookup.byName.get(cleanKey(branchName)) || sourceBranchAlias(branchName, lookup);
    if (branchId) return branchId;
    return UNMAPPED_BRANCH_PREFIX + branchName;
  }
  return access.branchId || access.branchIds?.[0] || "branch_hyd";
}

function sourceBranchAlias(branchName, lookup = null) {
  const key = cleanKey(branchName);
  const alias = SOURCE_BRANCH_ALIASES.find((item) => item.names.some((name) => cleanKey(name) === key));
  if (!alias) return "";
  if (!lookup || lookup.byId.has(alias.branchId)) return alias.branchId;
  return "";
}

function unmappedBranchName(branchId = "") {
  return cleanText(branchId).replace(UNMAPPED_BRANCH_PREFIX, "");
}

function resolveClient(payload, context) {
  const explicitClientId = cleanText(payload.clientId);
  if (explicitClientId) {
    const direct = context.clientIndex?.id.get(explicitClientId) || context.clientIndex?.original.get(explicitClientId);
    if (direct) return direct;
  }
  return findClient(payload, context, { ignoreOriginalRecordId: Boolean(explicitClientId) });
}

function ensureClient(payload, context, access, meta) {
  const existing = resolveClient(payload, context);
  if (existing) return existing;
  const clientOriginalId = cleanText(payload.clientId || payload.clientOriginalRecordId || payload.originalClientId || payload.originalRecordId || meta.originalRecordId);
  const clientMeta = { ...meta, originalRecordId: clientOriginalId };
  const created = insertRow("clients", {
    name: payload.clientName || "Imported Client",
    phone: payload.clientPhone || `imported-${randomUUID().slice(0, 8)}`,
    branchId: payload.branchId || access.branchId || access.branchIds?.[0] || "branch_hyd",
    tags: ["imported"],
    notes: "Auto-created during data migration",
    visitHistory: [],
    purchaseHistory: [],
    whatsappHistory: [],
    consentForms: [],
    ...clientMeta
  });
  context.clients.push(created);
  indexClientRecord(context, created);
  return created;
}

function ensureStaff(payload, context, access, meta) {
  const existing = resolveStaff(payload, context);
  if (existing) return existing;
  const sourceId = cleanText(payload.staffId || payload.originalStaffId || meta.originalRecordId);
  const staffMeta = { ...meta, originalRecordId: sourceId };
  const created = insertRow("staff", {
    name: cleanText(payload.staffName) || (sourceId ? "Imported Staff " + sourceId : "Imported Staff"),
    role: "Stylist",
    phone: "",
    email: "",
    branchId: payload.branchId || access.branchId || access.branchIds?.[0] || "branch_hyd",
    shift: "",
    status: "active",
    assignedServices: [],
    commissionRule: {},
    attendance: [],
    performance: {},
    notes: "Auto-created during data migration",
    ...staffMeta
  });
  context.staff.push(created);
  indexStaffRecord(context, created);
  return created;
}

function indexClientRecord(context, client) {
  if (!context.clientIndex) return;
  const id = cleanText(client.id);
  const original = cleanText(client.originalRecordId);
  const phone = normalizePhone(client.phone);
  const email = cleanText(client.email).toLowerCase();
  const name = cleanText(client.name).toLowerCase();
  if (id) context.clientIndex.id.set(id, client);
  if (original && !context.clientIndex.original.has(original)) context.clientIndex.original.set(original, client);
  if (phone && !context.clientIndex.phone.has(phone)) context.clientIndex.phone.set(phone, client);
  if (email && !context.clientIndex.email.has(email)) context.clientIndex.email.set(email, client);
  if (name && !context.clientIndex.name.has(name)) context.clientIndex.name.set(name, client);
}

function findClient(payload, context, options = {}) {
  const phone = normalizePhone(payload.phone || payload.clientPhone);
  const email = cleanText(payload.email).toLowerCase();
  const name = cleanText(payload.name || payload.clientName).toLowerCase();
  const originalRecordId = options.ignoreOriginalRecordId ? '' : cleanText(payload.originalRecordId || payload.sourceExternalId);
  const branchId = cleanText(payload.branchId);
  const indexed = [
    originalRecordId ? context.clientIndex?.original.get(originalRecordId) : null,
    phone ? context.clientIndex?.phone.get(phone) : null,
    email ? context.clientIndex?.email.get(email) : null
  ].find((client) => client && sameClientBranch(client, branchId));
  if (indexed || options.strongOnly) return indexed || null;
  const nameMatch = name ? context.clientIndex?.name.get(name) : null;
  if (nameMatch && sameClientBranch(nameMatch, branchId)) return nameMatch;
  return null;
}

function sameClientBranch(client, branchId) {
  return !branchId || !client.branchId || client.branchId === branchId;
}

function resolveStaff(payload, context) {
  const id = cleanText(payload.staffId);
  if (id) {
    const byId = context.staffIndex?.id.get(id) || context.staffIndex?.original.get(id);
    if (byId) return byId;
  }
  const name = cleanText(payload.staffName).toLowerCase();
  return name ? context.staffIndex?.name.get(name) || null : null;
}

function resolveProduct(payload, context) {
  const id = cleanText(payload.productId);
  if (id) return context.productIndex?.id.get(id) || context.productIndex?.original.get(id) || null;
  const branchId = cleanText(payload.branchId);
  const sku = cleanText(payload.sku).toLowerCase();
  const bySku = sku ? context.productIndex?.sku.get(branchKey(sku, branchId)) || context.productIndex?.sku.get(branchKey(sku, '')) : null;
  if (bySku) return bySku;
  const name = cleanText(payload.productName).toLowerCase();
  return name ? context.productIndex?.name.get(branchKey(name, branchId)) || context.productIndex?.name.get(branchKey(name, '')) || null : null;
}

function resolveInvoice(payload, context) {
  const id = cleanText(payload.invoiceId);
  if (id) return context.invoiceIndex?.id.get(id) || context.invoiceIndex?.original.get(id) || null;
  const number = cleanText(payload.invoiceNumber).toLowerCase();
  return number ? context.invoiceIndex?.number.get(number) || null : null;
}

function branchKey(value, branchId = "") {
  return `${cleanText(value).toLowerCase()}|${cleanText(branchId)}`;
}

function indexStaffRecord(context, staff) {
  if (!context.staffIndex) return;
  const id = cleanText(staff.id);
  const original = cleanText(staff.originalRecordId);
  const name = cleanText(staff.name).toLowerCase();
  const email = cleanText(staff.email).toLowerCase();
  const phone = normalizePhone(staff.phone);
  if (id) context.staffIndex.id.set(id, staff);
  if (original && !context.staffIndex.original.has(original)) context.staffIndex.original.set(original, staff);
  if (name && !context.staffIndex.name.has(name)) context.staffIndex.name.set(name, staff);
  if (email && !context.staffIndex.email.has(email)) context.staffIndex.email.set(email, staff);
  if (phone && !context.staffIndex.phone.has(phone)) context.staffIndex.phone.set(phone, staff);
}

function indexProductRecord(context, product) {
  if (!context.productIndex) return;
  const id = cleanText(product.id);
  const original = cleanText(product.originalRecordId);
  const branchId = cleanText(product.branchId);
  const sku = cleanText(product.sku).toLowerCase();
  const name = cleanText(product.name).toLowerCase();
  if (id) context.productIndex.id.set(id, product);
  if (original && !context.productIndex.original.has(original)) context.productIndex.original.set(original, product);
  if (sku && !context.productIndex.sku.has(branchKey(sku, branchId))) context.productIndex.sku.set(branchKey(sku, branchId), product);
  if (sku && !context.productIndex.sku.has(branchKey(sku, ""))) context.productIndex.sku.set(branchKey(sku, ""), product);
  if (name && !context.productIndex.name.has(branchKey(name, branchId))) context.productIndex.name.set(branchKey(name, branchId), product);
  if (name && !context.productIndex.name.has(branchKey(name, ""))) context.productIndex.name.set(branchKey(name, ""), product);
}

function indexInvoiceRecord(context, invoice) {
  if (!context.invoiceIndex) return;
  const id = cleanText(invoice.id);
  const original = cleanText(invoice.originalRecordId);
  const number = cleanText(invoice.invoiceNumber).toLowerCase();
  if (id) context.invoiceIndex.id.set(id, invoice);
  if (original && !context.invoiceIndex.original.has(original)) context.invoiceIndex.original.set(original, invoice);
  if (number && !context.invoiceIndex.number.has(number)) context.invoiceIndex.number.set(number, invoice);
}

function indexServiceRecord(context, service) {
  if (!context.serviceIndex) return;
  const id = cleanText(service.id);
  const name = cleanText(service.name).toLowerCase();
  if (id) context.serviceIndex.id.set(id, service);
  if (name && !context.serviceIndex.name.has(name)) context.serviceIndex.name.set(name, service);
}

function isBlockedAppointmentFields(fields = {}) {
  const text = [fields.serviceName, fields.serviceId, fields.status, fields.notes, fields.lineItem].map(cleanText).join(" ").toLowerCase();
  return /(aptblock|blocked?|block time|break|lunch|hold)/.test(text);
}

function ensureUniqueInvoiceNumbers(rows = [], access = {}) {
  const used = new Set(listRows("invoices", { tenantId: access.tenantId, limit: 100000 }).map((invoice) => cleanText(invoice.invoiceNumber).toLowerCase()).filter(Boolean));
  const generatedBySourceId = new Map();
  const invoiceNumberCounts = new Map();
  for (const row of rows.filter((item) => item.resource === "invoices")) {
    const original = cleanText(row.payload.invoiceNumber);
    const key = original.toLowerCase();
    invoiceNumberCounts.set(key, (invoiceNumberCounts.get(key) || 0) + 1);
    if (key && !used.has(key) && invoiceNumberCounts.get(key) === 1) {
      used.add(key);
      continue;
    }
    const generated = uniqueTargetInvoiceNumber(row, access, used);
    row.payload.originalInvoiceNumber = original;
    row.payload.invoiceNumber = generated;
    row.fields.invoiceNumber = generated;
    if (row.sourceExternalId) generatedBySourceId.set(row.sourceExternalId, generated);
    used.add(generated.toLowerCase());
  }
  for (const row of rows.filter((item) => item.resource === "payments")) {
    const invoiceId = cleanText(row.payload.invoiceId);
    if (invoiceId && generatedBySourceId.has(invoiceId)) row.payload.invoiceNumber = generatedBySourceId.get(invoiceId);
  }
}

function uniqueInvoiceNumberForImport(payload = {}, context = {}, access = {}, meta = {}, sale = {}) {
  const used = new Set((context.invoices || []).map((invoice) => cleanText(invoice.invoiceNumber).toLowerCase()).filter(Boolean));
  const requested = cleanText(payload.invoiceNumber);
  if (requested && !used.has(requested.toLowerCase())) return requested;
  return uniqueTargetInvoiceNumber({ payload, sourceExternalId: meta.originalRecordId || payload.saleId || sale.id || requested }, access, used);
}

function uniqueTargetInvoiceNumber(row = {}, access = {}, usedNumbers = new Set()) {
  const used = new Set(usedNumbers);
  const seed = cleanText(row.sourceExternalId || row.payload?.originalRecordId || row.payload?.invoiceNumber || row.payload?.saleId || (cleanText(row.sourceSheet || "invoice") + ":" + cleanText(row.sourceRowNumber || "")));
  const base = "MIG-" + slug(seed || randomUUID()).slice(0, 32).toUpperCase();
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = base + "-" + suffix;
  }
  return candidate;
}

function resolveServiceIds(payload, context) {
  const ids = Array.isArray(payload.serviceIds) ? payload.serviceIds : [];
  const resolved = ids.filter((id) => context.serviceIndex?.id.has(id));
  if (payload.serviceName) {
    const service = context.serviceIndex?.name.get(cleanText(payload.serviceName).toLowerCase());
    if (service) resolved.push(service.id);
  }
  return Array.from(new Set(resolved));
}

function updateClientHistory(client, sale, access) {
  const purchaseHistory = Array.isArray(client.purchaseHistory) ? client.purchaseHistory : [];
  purchaseHistory.push({ date: sale.createdAt, invoice: "Imported", amount: sale.total });
  updateRow("clients", client.id, {
    totalSpend: Number(client.totalSpend || 0) + Number(sale.total || 0),
    visitCount: Number(client.visitCount || 0) + 1,
    lastVisitAt: sale.createdAt || now(),
    purchaseHistory
  }, { tenantId: access.tenantId });
}

function migrationMeta(row, batchId, sourceSoftware) {
  const stamp = now();
  return {
    imported: 1,
    originalSystem: sourceSoftware,
    originalRecordId: row.sourceExternalId,
    importedAt: stamp,
    importBatchId: batchId
  };
}

function persistPreview(response, access, dryRun) {
  const job = insertMigrationRow("migration_jobs", {
    tenantId: access.tenantId,
    sourceSoftware: response.sourceSoftware,
    fileName: response.fileName,
    status: "ready",
    dryRun: dryRun ? 1 : 0,
    totalRows: response.summary.totalRows,
    warningRows: response.summary.warningRows,
    errorRows: response.summary.errorRows,
    summary: response.summary,
    mapping: response.mapping
  });
  for (const row of response.rows) {
    insertMigrationRow("migration_row_results", {
      id: makeIdLong("migres"),
      tenantId: access.tenantId,
      jobId: job.id,
      resource: row.resource,
      entity: row.resource,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      sourceExternalId: row.sourceExternalId,
      action: "preview",
      status: row.status,
      message: row.message,
      payload: row.payload,
      raw: row.raw,
      errors: row.errors,
      warnings: row.warnings
    });
  }
}

function auditMigration(action, details, access) {
  try {
    insertMigrationRow("migration_audit_logs", {
      tenantId: access.tenantId,
      jobId: details.jobId || "",
      batchId: details.batchId || "",
      action,
      actorUserId: access.userId || "system",
      details
    });
    securityService.audit({
      action,
      targetType: "migration",
      targetId: details.jobId || details.batchId || "",
      details,
      severity: action.includes("rollback") ? "warning" : "info"
    }, access);
  } catch {
    // Migration audit must never interrupt the import transaction.
  }
}

function templateFor(resource) {
  const key = canonicalResource(resource);
  const template = RESOURCE_TEMPLATES[key];
  if (!template) throw badRequest(`Unsupported migration resource: ${resource}`);
  return {
    resource: key,
    table: template.table,
    required: template.required,
    columns: template.fields.map((field) => ({
      field,
      required: template.required.includes(field),
      aliases: FIELD_ALIASES[field] || [field],
      example: exampleFor(field)
    }))
  };
}

function jsonBind(value) {
  if (value === undefined || value === null) return value ?? null;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return value;
}

function jsonBindData(data = {}) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, jsonBind(value)]));
}

function insertMigrationRow(table, data) {
  return insertRow(table, jsonBindData(data));
}

function updateMigrationRow(table, rowId, data, scope) {
  return updateRow(table, rowId, jsonBindData(data), scope);
}

function migrationEntityTotals(access = {}) {
  const tenantId = access.tenantId || "";
  const branchId = access.requestedBranchId || access.branchId || "";
  if (!tenantId) return [];
  return Object.entries(RESOURCE_TEMPLATES).map(([resource, template]) => {
    const table = template.table;
    const label = resource === "clients" ? "Client Master" : resourceLabel(resource);
    const columns = new Set(columnsFor(table));
    const activeWhere = ["tenantId = @tenantId"];
    if (columns.has("deletedAt")) activeWhere.push("(deletedAt IS NULL OR deletedAt = '')");
    if (columns.has("archivedAt")) activeWhere.push("(archivedAt IS NULL OR archivedAt = '')");
    if (columns.has("status")) activeWhere.push("LOWER(COALESCE(status, '')) NOT IN ('deleted', 'archived')");
    const branchWhere = branchId && columns.has("branchId") ? " AND branchId = @branchId" : "";
    const importedWhere = columns.has("imported") ? " AND imported = 1" : columns.has("importBatchId") ? " AND COALESCE(importBatchId, '') <> ''" : "";
    const params = { tenantId, branchId };
    try {
      assertValidTable(table, "migrationEntityTotals");
      const total = Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${activeWhere.join(" AND ")}`).get(params)?.total || 0);
      const branchTotal = branchWhere ? Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${activeWhere.join(" AND ")}${branchWhere}`).get(params)?.total || 0) : total;
      const migrated = importedWhere ? Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${activeWhere.join(" AND ")}${importedWhere}`).get(params)?.total || 0) : 0;
      return { resource, label, table, total, branchTotal, migrated };
    } catch {
      return { resource, label, table, total: 0, branchTotal: 0, migrated: 0 };
    }
  });
}

function resourceLabel(resource = "") {
  return String(resource || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
function liveClientTotals(access = {}) {
  const tenantId = access.tenantId || "";
  const branchId = access.requestedBranchId || access.branchId || "";
  if (!tenantId) {
    return { liveClientCount: 0, liveClientBranchCount: 0, migratedClientCount: 0, migratedClientBranchCount: 0, selectedBranchId: "" };
  }

  const columns = new Set(columnsFor("clients"));
  const activeWhere = ["tenantId = ?"];
  if (columns.has("deletedAt")) activeWhere.push("COALESCE(deletedAt, '') = ''");

  const importedSignals = [];
  if (columns.has("imported")) importedSignals.push("imported = 1");
  if (columns.has("importBatchId")) importedSignals.push("COALESCE(importBatchId, '') <> ''");
  if (columns.has("migrationBatchId")) importedSignals.push("COALESCE(migrationBatchId, '') <> ''");

  const count = (extraWhere = [], params = []) => db
    .prepare(`SELECT COUNT(*) AS count FROM clients WHERE ${[...activeWhere, ...extraWhere].join(" AND ")}`)
    .get(tenantId, ...params)?.count || 0;

  const branchWhere = branchId ? ["branchId = ?"] : [];
  const branchParams = branchId ? [branchId] : [];
  const migratedWhere = importedSignals.length ? [`(${importedSignals.join(" OR ")})`] : [];

  return {
    liveClientCount: Number(count()),
    liveClientBranchCount: Number(count(branchWhere, branchParams)),
    migratedClientCount: Number(count(migratedWhere)),
    migratedClientBranchCount: Number(count([...branchWhere, ...migratedWhere], branchParams)),
    selectedBranchId: branchId
  };
}

function autoMapColumns(columns, resource) {
  const template = RESOURCE_TEMPLATES[resource];
  const mapping = {};
  const unmatched = [];
  for (const column of columns) {
    const cleanColumn = cleanKey(column);
    const field = template.fields.find((candidate) => cleanKey(candidate) === cleanColumn || (FIELD_ALIASES[candidate] || []).some((alias) => cleanKey(alias) === cleanColumn));
    if (field) mapping[column] = field;
    else unmatched.push(column);
  }
  return { mapping, unmatched };
}

// --- AI-style field mapping with confidence scoring ---
function scoreFieldMatch(column, field) {
  const col = cleanKey(column);
  const fieldKey = cleanKey(field);
  if (!col) return 0;
  if (col === fieldKey) return 100; // exact field name
  const aliases = (FIELD_ALIASES[field] || []).map(cleanKey);
  if (aliases.includes(col)) return 95; // exact alias match
  let best = 0;
  for (const alias of [fieldKey, ...aliases]) {
    if (!alias) continue;
    if (col.includes(alias) || alias.includes(col)) {
      const ratio = Math.min(col.length, alias.length) / Math.max(col.length, alias.length);
      best = Math.max(best, Math.round(60 + ratio * 25)); // 60–85 partial overlap
    }
  }
  return best;
}

function suggestColumnMappings(columns, resource) {
  const template = RESOURCE_TEMPLATES[resource];
  const REVIEW_THRESHOLD = 80;
  const suggestions = columns.map((column) => {
    let suggestedField = null;
    let confidence = 0;
    for (const field of template.fields) {
      const score = scoreFieldMatch(column, field);
      if (score > confidence) {
        confidence = score;
        suggestedField = field;
      }
    }
    const status =
      confidence >= 95 ? "auto" :
      confidence >= REVIEW_THRESHOLD ? "likely" :
      confidence > 0 ? "review" : "unmapped";
    return {
      column,
      suggestedField: confidence > 0 ? suggestedField : null,
      confidence,
      needsReview: confidence < REVIEW_THRESHOLD,
      status
    };
  });
  const confidentFields = new Set(
    suggestions.filter((s) => s.confidence >= REVIEW_THRESHOLD).map((s) => s.suggestedField)
  );
  const missingRequired = (template.required || []).filter((f) => !confidentFields.has(f));
  const readiness = suggestions.length
    ? Math.round(suggestions.reduce((sum, s) => sum + s.confidence, 0) / suggestions.length)
    : 0;
  return { resource, readiness, missingRequired, suggestions };
}

// --- Migration approval workflow (self-contained, lazy table) ---
let migrationApprovalSchemaReady = false;
export function ensureMigrationApprovalSchema() {
  if (migrationApprovalSchemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_approvals (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      jobId TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT NOT NULL DEFAULT '',
      summaryJson TEXT NOT NULL DEFAULT '{}',
      submittedBy TEXT NOT NULL DEFAULT '',
      submittedAt TEXT NOT NULL DEFAULT '',
      reviewedBy TEXT NOT NULL DEFAULT '',
      reviewedAt TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL DEFAULT '',
      sourceSoftware TEXT NOT NULL DEFAULT '',
      fileName TEXT NOT NULL DEFAULT '',
      sourceFileHash TEXT NOT NULL DEFAULT '',
      totalRows INTEGER NOT NULL DEFAULT 0,
      errorCount INTEGER NOT NULL DEFAULT 0,
      warningCount INTEGER NOT NULL DEFAULT 0,
      validRows INTEGER NOT NULL DEFAULT 0,
      importableRows INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureMigrationApprovalColumns();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_migration_approvals_scope
      ON migration_approvals (tenantId, status, createdAt);
    CREATE INDEX IF NOT EXISTS idx_migration_approvals_identity
      ON migration_approvals (tenantId, status, sourceFileHash, jobId, fileName, totalRows);
  `);
  migrationApprovalSchemaReady = true;
}

function ensureMigrationApprovalColumns() {
  const columns = new Set(db.prepare("PRAGMA table_info(migration_approvals)").all().map((column) => column.name));
  const requiredColumns = [
    ["branchId", "TEXT NOT NULL DEFAULT ''"],
    ["jobId", "TEXT NOT NULL DEFAULT ''"],
    ["resource", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["note", "TEXT NOT NULL DEFAULT ''"],
    ["summaryJson", "TEXT NOT NULL DEFAULT '{}'"],
    ["submittedBy", "TEXT NOT NULL DEFAULT ''"],
    ["submittedAt", "TEXT NOT NULL DEFAULT ''"],
    ["reviewedBy", "TEXT NOT NULL DEFAULT ''"],
    ["reviewedAt", "TEXT NOT NULL DEFAULT ''"],
    ["createdAt", "TEXT NOT NULL DEFAULT ''"],
    ["updatedAt", "TEXT NOT NULL DEFAULT ''"],
    ["sourceSoftware", "TEXT NOT NULL DEFAULT ''"],
    ["fileName", "TEXT NOT NULL DEFAULT ''"],
    ["sourceFileHash", "TEXT NOT NULL DEFAULT ''"],
    ["totalRows", "INTEGER NOT NULL DEFAULT 0"],
    ["errorCount", "INTEGER NOT NULL DEFAULT 0"],
    ["warningCount", "INTEGER NOT NULL DEFAULT 0"],
    ["validRows", "INTEGER NOT NULL DEFAULT 0"],
    ["importableRows", "INTEGER NOT NULL DEFAULT 0"]
  ];
  for (const [name, definition] of requiredColumns) {
    if (!columns.has(name)) {
      db.prepare(`ALTER TABLE migration_approvals ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

function deserializeApproval(row) {
  let summary = {};
  try {
    summary = JSON.parse(row.summaryJson || "{}");
  } catch {
    summary = {};
  }
  const { summaryJson, ...rest } = row;
  return { ...rest, summary };
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function mergeMapping(autoMapping, provided, columns, resource) {
  const mapping = { ...autoMapping };
  const fields = new Set(RESOURCE_TEMPLATES[resource].fields);
  for (const [key, value] of Object.entries(provided || {})) {
    if (columns.includes(key) && (fields.has(value) || value === "__ignore")) mapping[key] = value;
    if (fields.has(key) && columns.includes(value)) mapping[value] = key;
  }
  return mapping;
}

function detectResource(sheetName) {
  const cleaned = cleanKey(sheetName);
  for (const [resource, aliases] of Object.entries(RESOURCE_ALIASES)) {
    if (aliases.some((alias) => cleaned.includes(cleanKey(alias)))) return resource;
  }
  return "";
}

function canonicalResource(resource) {
  const cleaned = cleanKey(resource);
  if (!cleaned || cleaned === "auto") return "";
  if (RESOURCE_TEMPLATES[cleaned]) return cleaned;
  for (const [key, aliases] of Object.entries(RESOURCE_ALIASES)) {
    if (aliases.some((alias) => cleanKey(alias) === cleaned)) return key;
  }
  if (cleaned === "suppliers") return "vendors";
  if (cleaned === "finance expenses") return "expenses";
  return "";
}

function sourceKey(value) {
  const cleaned = cleanKey(value || "excel").replace(/\s+/g, "-");
  return SOURCE_ADAPTERS[cleaned] ? cleaned : "excel";
}

function adapterFor(sourceSoftware) {
  return `${sourceSoftware}-${SOURCE_ADAPTERS[sourceSoftware]?.type || "spreadsheet"}`;
}

function migrationSourceHash(payload = {}, access = {}) {
  if (payload.sourceFileHash) return cleanText(payload.sourceFileHash);
  const evidence = migrationSourceEvidence(payload, access, payload.fileName || "");
  if (evidence?.sha256) return evidence.sha256;
  return "";
}

function buildMigrationCommandCenter(preview = {}, payload = {}, access = {}) {
  const summary = preview.summary || {};
  const rows = Array.isArray(preview.allRows) ? preview.allRows : [];
  const byResource = summary.byResource || summary.byEntity || {};
  const byBranch = summary.byBranch || branchSummaryFromRows(rows);
  const resources = Object.keys(byResource);
  const missingFields = resources.map((resource) => {
    const template = templateFor(resource);
    const available = new Set(rows.filter((row) => row.resource === resource).flatMap((row) => Object.keys(row.raw || row.fields || {})).map((key) => cleanKey(key)));
    const missing = (template.required || []).filter((field) => !available.has(cleanKey(field)) && rows.some((row) => row.resource === resource && !row.fields?.[field]));
    return { resource, missing };
  }).filter((item) => item.missing.length);
  const mappingMemory = resources.map((resource) => mappingMemoryFor(resource, payload, access)).filter(Boolean);
  const conflicts = rows.filter((row) => row.status === "duplicate" || String(row.message || "").toLowerCase().includes("duplicate") || String(row.message || "").toLowerCase().includes("already"));
  const branchImpact = Object.entries(byBranch).map(([branchId, bucket]) => ({
    branchId: branchId || access.branchId || "unassigned",
    totalRows: Number(bucket.total || 0),
    validRows: Number(bucket.valid || 0),
    warningRows: Number(bucket.warnings || bucket.warningRows || 0),
    errorRows: Number(bucket.errors || bucket.errorRows || 0),
    estimatedImportRows: Math.max(0, Number(bucket.valid || 0) - Number(bucket.duplicates || 0)),
    franchiseRisk: Number(bucket.errors || 0) ? "blocked" : Number(bucket.warnings || 0) ? "review" : "ready"
  }));
  const recommendedActions = [];
  if (missingFields.length) recommendedActions.push("Complete required field mappings before approval.");
  if (conflicts.length) recommendedActions.push("Resolve duplicate conflicts in the merge studio.");
  if (Number(summary.errorRows || 0)) recommendedActions.push("Fix critical rows or enable partial import for valid rows only.");
  if (!recommendedActions.length) recommendedActions.push("Ready for dry-run, owner approval, and queued import.");
  return {
    fileName: preview.fileName,
    sourceSoftware: preview.sourceSoftware,
    generatedAt: now(),    liveTotals: migrationEntityTotals(access),
    totals: {
      totalRows: Number(summary.totalRows || 0),
      validRows: Number(summary.validRows || 0),
      warningRows: Number(summary.warningRows || 0),
      errorRows: Number(summary.errorRows || 0),
      duplicateRows: Number(summary.duplicateRows || 0)
    },
    entities: Object.entries(byResource).map(([resource, bucket]) => ({ resource, ...bucket })),
    branches: branchImpact,
    missingFields,
    mappingMemory,
    conflicts: {
      total: conflicts.length,
      rows: conflicts.slice(0, 100).map((row) => ({
        resource: row.resource,
        sourceRowNumber: row.sourceRowNumber,
        status: row.status,
        message: row.message,
        targetId: row.targetId || row.existingId || "",
        fields: row.fields || {}
      }))
    },
    simulator: {
      mode: payload.simulationMode || "branch_franchise_preview",
      branchCount: branchImpact.length,
      readyBranches: branchImpact.filter((branch) => branch.franchiseRisk === "ready").length,
      blockedBranches: branchImpact.filter((branch) => branch.franchiseRisk === "blocked").length,
      estimatedImportRows: branchImpact.reduce((total, branch) => total + branch.estimatedImportRows, 0)
    },
    recommendedActions
  };
}

function branchSummaryFromRows(rows = []) {
  const result = {};
  for (const row of rows) {
    const branchId = cleanText(row.fields?.branchId || row.raw?.branchId || row.branchId || "unassigned");
    if (!result[branchId]) result[branchId] = { total: 0, valid: 0, warnings: 0, errors: 0, duplicates: 0 };
    result[branchId].total += 1;
    if (row.status === "error") result[branchId].errors += 1;
    else if (row.status === "warning") result[branchId].warnings += 1;
    else result[branchId].valid += 1;
    if (row.status === "duplicate" || String(row.message || "").toLowerCase().includes("duplicate")) result[branchId].duplicates += 1;
  }
  return result;
}

function mappingMemoryFor(resource, payload = {}, access = {}) {
  const canonical = canonicalResource(resource || "");
  if (!canonical) return null;
  const row = db.prepare(`
    SELECT * FROM migration_mappings
    WHERE tenantId = @tenantId AND resource = @resource
      AND (@sourceSoftware = '' OR sourceSoftware = @sourceSoftware)
    ORDER BY updatedAt DESC
    LIMIT 1
  `).get({
    tenantId: access.tenantId,
    resource: canonical,
    sourceSoftware: sourceKey(payload.sourceSoftware || "")
  });
  if (!row) return { resource: canonical, learned: false, mapping: suggestColumnMappings(Object.keys((payload.mapping || {})), canonical) };
  const parsed = deserializeJson(row, ["mapping", "unmatchedColumns", "requiredFields"]);
  return {
    resource: canonical,
    learned: true,
    mappingId: parsed.id,
    name: parsed.name,
    mapping: parsed.mapping || {},
    unmatchedColumns: parsed.unmatchedColumns || [],
    requiredFields: parsed.requiredFields || []
  };
}

function buildMigrationProofPack(payload = {}, access = {}) {
  const jobId = cleanText(payload.jobId || payload.id || "");
  const job = jobId ? db.prepare("SELECT * FROM migration_jobs WHERE id = @id AND tenantId = @tenantId").get({ id: jobId, tenantId: access.tenantId }) : null;
  const largeJob = !job && jobId ? largeMigrationJob(jobId, access) : null;
  const jobs = job ? [deserializeJson(job, ["summary", "mapping", "settings"])] : migrationService.jobs(access).slice(0, 10);
  const totals = jobs.reduce((acc, item) => {
    acc.totalRows += Number(item.totalRows || item.summary?.totalRows || 0);
    acc.importedRows += Number(item.importedRows || item.summary?.importedRows || 0);
    acc.errorRows += Number(item.errorRows || item.summary?.errorRows || 0);
    acc.skippedRows += Number(item.skippedRows || item.summary?.skippedRows || 0);
    return acc;
  }, { totalRows: 0, importedRows: 0, errorRows: 0, skippedRows: 0 });
  return {
    generatedAt: now(),
    tenantId: access.tenantId,
    branchId: access.branchId || "",
    scope: jobId ? "single_job" : "recent_jobs",
    jobId,
    job: job ? jobs[0] : null,
    largeJob,
    totals,
    jobs,
    controls: {
      rollbackAvailable: Boolean(job && job.status !== "rolled_back"),
      auditStamped: true,
      sourceEvidenceRequired: true,
      approvalRequired: true
    }
  };
}
function migrationSourceEvidence(payload = {}, access = {}, fileName = "") {
  if (payload.sourceFileHash && !payload.fileRef && !payload.fileBase64) {
    return {
      fileRef: "",
      fileName: fileName || payload.fileName || "migration-source",
      sizeBytes: integer(payload.fileSizeBytes, 0),
      sha256: cleanText(payload.sourceFileHash),
      storage: "client_sha256"
    };
  }
  if (payload.fileRef) {
    const upload = migrationUploadStore.read(payload.fileRef, access);
    return {
      fileRef: upload.fileRef,
      fileName: upload.fileName || fileName,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      storage: "migration_uploads"
    };
  }
  const raw = String(payload.fileBase64 || "");
  if (!raw) return null;
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  return {
    fileRef: "",
    fileName: fileName || payload.fileName || "migration-source",
    sizeBytes: Buffer.from(base64 || "", "base64").length,
    sha256: createHash("sha256").update(base64 || "", "utf8").digest("hex"),
    storage: "inline_base64"
  };
}

function findDuplicateImportJob(access = {}, identity = {}) {
  const rows = db.prepare(`
    SELECT * FROM migration_jobs
    WHERE tenantId = @tenantId
      AND dryRun = 0
      AND fileName = @fileName
      AND status IN ('completed', 'completed_with_errors')
    ORDER BY createdAt DESC
    LIMIT 20
  `).all({ tenantId: access.tenantId, fileName: cleanText(identity.fileName) }).map((row) => deserializeJson(row, ["summary", "mapping", "settings"]));
  return rows.find((job) => sameImportIdentity(job, identity)) || null;
}

function sameImportIdentity(job = {}, identity = {}) {
  if (cleanText(job.sourceSoftware) !== cleanText(identity.sourceSoftware)) return false;
  const jobResource = cleanText(job.resource || "auto");
  const incomingResource = cleanText(identity.resource || "auto");
  if (jobResource !== incomingResource) return false;
  if (Number(job.totalRows || 0) !== Number(identity.totalRows || 0)) return false;
  const existingHash = cleanText(job.settings?.sourceFileHash || "");
  const incomingHash = cleanText(identity.sourceFileHash || "");
  return Boolean(existingHash && incomingHash && existingHash === incomingHash);
}

function latestBatchForJob(jobId, access = {}) {
  return db.prepare(`
    SELECT * FROM migration_import_batches
    WHERE tenantId = @tenantId AND jobId = @jobId AND status <> 'rolled_back'
    ORDER BY createdAt DESC
    LIMIT 1
  `).get({ tenantId: access.tenantId, jobId }) || null;
}
function importSettings(payload, access = {}) {
  return {
    migrationMode: payload.migrationMode !== false,
    preserveCreatedAt: true,
    preserveInvoiceNumbers: true,
    preserveHistoricalPayments: true,
    partialFailureHandling: "row-level",
    allowPartialImport: payload.allowPartialImport === true,
    sourceFileHash: migrationSourceHash(payload, access),
    originalSystem: payload.sourceSoftware || "excel",
    sandboxMode: payload.sandboxMode !== false,
    duplicateDecisions: payload.duplicateDecisions || {},
    approvalGate: payload.skipApprovalGate === true ? "skipped_by_admin" : "required",
    sourceEvidence: migrationSourceEvidence(payload, access, payload.fileName || "")
  };
}

function emptySummary(sourceSoftware, fileName, dryRun) {
  return {
    sourceSoftware,
    fileName,
    dryRun,
    totalRows: 0,
    validRows: 0,
    warningRows: 0,
    errorRows: 0,
    duplicateRows: 0,
    affectedRecords: 0,
    byEntity: {},
    byResource: {},
    byBranch: {}
  };
}

function addSummary(summary, resource, checked) {
  summary.totalRows++;
  summary.byResource[resource] = summary.byResource[resource] || { total: 0, valid: 0, warnings: 0, errors: 0, duplicates: 0 };
  summary.byEntity[resource] = summary.byResource[resource];
  const bucket = summary.byResource[resource];
  bucket.total++;
  if (checked.status === "error") {
    summary.errorRows++;
    bucket.errors++;
  } else if (checked.status === "warning") {
    summary.warningRows++;
    bucket.warnings++;
  } else {
    summary.validRows++;
    bucket.valid++;
  }
  if (checked.duplicate) {
    summary.duplicateRows++;
    bucket.duplicates++;
  }
}

function branchSummary(rows) {
  const summary = {};
  for (const row of rows) {
    const branchId = row.payload.branchId || "global";
    summary[branchId] = summary[branchId] || { total: 0, valid: 0, warnings: 0, errors: 0 };
    summary[branchId].total++;
    if (row.status === "error") summary[branchId].errors++;
    else if (row.status === "warning") summary[branchId].warnings++;
    else summary[branchId].valid++;
  }
  return summary;
}

function progressFor(job) {
  const total = Number(job.totalRows || 0);
  if (!total) return 0;
  return Math.round(((Number(job.importedRows || 0) + Number(job.skippedRows || 0) + Number(job.errorRows || 0)) / total) * 100);
}

const LARGE_CHUNK_LOCKED_STATUSES = new Set(["imported", "rolled_back", "cancelled"]);

function assertLargeChunkMutable(chunk, action) {
  if (!chunk || !LARGE_CHUNK_LOCKED_STATUSES.has(chunk.status)) return;
  throw badRequest(`Chunk ${chunk.chunkNumber} is ${chunk.status} and cannot be ${action}. Create a new migration job or rollback before retrying.`);
}

function assertLargeChunkChecksum(chunk, checksum, action) {
  if (!chunk || !chunk.checksum || !checksum || chunk.checksum === checksum) return;
  throw badRequest(`Chunk ${chunk.chunkNumber} checksum changed and cannot be ${action}. Upload it as a new chunk or create a new migration job.`);
}

function assertLargeChunkImportable(chunk) {
  if (!chunk) return;
  if (chunk.status === "imported") {
    throw badRequest(`Chunk ${chunk.chunkNumber} is already imported and cannot be imported again.`);
  }
  if (["rolled_back", "cancelled"].includes(chunk.status)) {
    throw badRequest(`Chunk ${chunk.chunkNumber} is ${chunk.status} and cannot be imported.`);
  }
}

function migrationJobNotReady(message) {
  const error = badRequest(message);
  error.code = "MIGRATION_JOB_NOT_READY";
  return error;
}
function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function cleanKey(value) {
  return cleanText(value).toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function empty(value) {
  return cleanText(value) === "";
}

function same(left, right) {
  return cleanKey(left) === cleanKey(right);
}

function normalizePhone(value) {
  return cleanText(value).replace(/[^\d+]/g, "").replace(/^91(?=\d{10}$)/, "");
}

function numberValue(value, fallback = 0) {
  const parsed = Number(cleanText(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.round(numberValue(value, fallback));
}

function money(value) {
  return numberValue(value, 0);
}

function boolValue(value) {
  return ["1", "true", "yes", "y", "auto", "enabled"].includes(cleanKey(value));
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = cleanText(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function dateOnly(value) {
  const date = dateValue(value);
  return date.includes("T") ? date.slice(0, 10) : date;
}

function splitList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return cleanText(value).split(/[,|;]/).map((item) => item.trim()).filter(Boolean);
}

function slug(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `SKU-${randomUUID().slice(0, 6)}`;
}

function exampleFor(field) {
  const examples = {
    name: "Riya Sharma",
    phone: "+91 98765 43210",
    email: "riya@example.com",
    branchId: "branch_hyd",
    price: "1200",
    invoiceNumber: "INV-2024-001",
    createdAt: "2024-04-01",
    amount: "1500",
    startAt: "2024-04-01 11:00"
  };
  return examples[field] || "";
}

function cancelLargeJobChunks(jobId, access) {
  const ts = now();
  const result = db.prepare(`
    UPDATE migration_file_chunks
       SET status = 'cancelled', failureReason = 'operator cancel', completedAt = @ts, updatedAt = @ts
     WHERE tenantId = @tenantId
       AND jobId = @jobId
       AND status NOT IN ('imported', 'rolled_back', 'cancelled')
  `).run({ tenantId: access.tenantId, jobId, ts });
  db.prepare(`
    UPDATE migration_staging_rows
       SET status = 'cancelled', updatedAt = @ts
     WHERE tenantId = @tenantId
       AND jobId = @jobId
       AND status NOT IN ('imported', 'created', 'merged', 'linked')
  `).run({ tenantId: access.tenantId, jobId, ts });
  return result.changes || 0;
}

function resetFailedLargeJobChunks(jobId, access, payload = {}) {
  const chunkNumber = integer(payload.chunkNumber, 0);
  const retryCancelled = payload.includeCancelled === true;
  const retryStatuses = retryCancelled
    ? "'failed', 'imported_with_errors', 'cancelled'"
    : "'failed', 'imported_with_errors'";
  const where = ["tenantId = @tenantId", "jobId = @jobId", `status IN (${retryStatuses})`];
  const params = { tenantId: access.tenantId, jobId, ts: now() };
  if (chunkNumber) {
    where.push("chunkNumber = @chunkNumber");
    params.chunkNumber = chunkNumber;
  }
  const whereSql = where.join(" AND ");
  const result = db.prepare(`
    UPDATE migration_file_chunks
       SET status = CASE WHEN errorRows > 0 THEN 'analyzed_with_errors' ELSE 'analyzed' END,
           failureReason = '', failedAt = '', updatedAt = @ts
     WHERE ${whereSql}
  `).run(params);
  if (retryCancelled && result.changes) {
    const chunkFilter = chunkNumber ? "AND chunkNumber = @chunkNumber" : "";
    db.prepare(`
      UPDATE migration_staging_rows
         SET status = CASE
           WHEN errors IS NOT NULL AND errors <> '' AND errors <> '[]' THEN 'error'
           WHEN warnings IS NOT NULL AND warnings <> '' AND warnings <> '[]' THEN 'warning'
           ELSE 'ok'
         END,
         updatedAt = @ts
       WHERE tenantId = @tenantId
         AND jobId = @jobId
         AND status = 'cancelled'
         AND chunkId IN (
           SELECT id FROM migration_file_chunks
           WHERE tenantId = @tenantId AND jobId = @jobId ${chunkFilter}
         )
    `).run(params);
  }
  return result.changes || 0;
}
function processQueuedLargeMigrationJobs(payload = {}, access = {}) {
  const maxJobs = Math.max(1, Math.min(20, integer(payload.maxJobs, 3)));
  const workerId = workerIdFor(payload, access);
  const lockTimeoutMs = Math.max(60000, Math.min(3600000, integer(payload.lockTimeoutMs, 120000)));
  const staleBefore = new Date(Date.now() - lockTimeoutMs).toISOString();
  const params = { limit: maxJobs, staleBefore };
  const tenantWhere = access.tenantId ? "AND tenantId = @tenantId" : "";
  if (access.tenantId) params.tenantId = access.tenantId;
  const rows = db.prepare(`
    SELECT * FROM migration_large_jobs
    WHERE (status = 'queued' OR (status = 'processing' AND (workerId = '' OR lockedAt = '' OR lockedAt < @staleBefore))) ${tenantWhere}
    ORDER BY createdAt ASC
    LIMIT @limit
  `).all(params).map(deserializeDirectRow);
  const results = [];
  for (const job of rows) {
    const jobAccess = workerAccessForJob(job, { ...access, workerId });
    const settings = parseJsonField(job.settings, {});
    const worker = { ...settings, ...settings.worker, ...payload, workerId, lockTimeoutMs, workerTick: true };
    if (!claimLargeMigrationJob(job, worker, jobAccess)) {
      results.push({ jobId: job.id, ok: false, claimed: false, status: job.status });
      continue;
    }
    try {
      assertLargeJobReadyForImport(job.id, worker, jobAccess);
      const result = processLargeJobStagedChunks(job.id, worker, jobAccess);
      const releasedJob = releaseLargeMigrationJob(job.id, worker, jobAccess);
      results.push({ jobId: job.id, ok: true, claimed: true, processedChunks: result.processedChunks, status: releasedJob?.status || result.job?.status || "processing" });
    } catch (error) {
      const notReady = error.code === "MIGRATION_JOB_NOT_READY";
      updateDirectRow("migration_large_jobs", job.id, {
        status: notReady ? "paused" : "failed",
        workerId: "",
        lockedAt: "",
        heartbeatAt: "",
        failedAt: notReady ? "" : now(),
        failureReason: error.message || "Worker failed"
      }, jobAccess);
      results.push({ jobId: job.id, ok: false, claimed: true, message: error.message });
    }
  }
  return { ok: true, workerId, checkedJobs: rows.length, results, ranAt: now() };
}
function workerSettings(payload = {}) {
  return {
    maxChunks: Math.max(1, Math.min(100, integer(payload.maxChunks, 5))),
    stopOnError: payload.stopOnError !== false,
    skipApprovalGate: payload.skipApprovalGate === true,
    allowPartialImport: payload.allowPartialImport === true,
    migrationMode: payload.migrationMode !== false,
    queuedBy: cleanText(payload.queuedBy || "")
  };
}


function workerIdFor(payload = {}, access = {}) {
  const explicit = cleanText(payload.workerId || access.workerId || "");
  return explicit || `migration-worker-${process.pid || "local"}`;
}

function claimLargeMigrationJob(job, worker, access) {
  const ts = now();
  const lockTimeoutMs = Math.max(60000, Math.min(3600000, integer(worker.lockTimeoutMs, 120000)));
  const staleBefore = new Date(Date.now() - lockTimeoutMs).toISOString();
  const result = db.prepare(`
    UPDATE migration_large_jobs
       SET status = 'processing',
           workerId = @workerId,
           lockedAt = @ts,
           heartbeatAt = @ts,
           startedAt = CASE WHEN startedAt = '' THEN @ts ELSE startedAt END,
           failureReason = '',
           updatedAt = @ts
     WHERE id = @id
       AND tenantId = @tenantId
       AND status IN ('queued', 'processing')
       AND (status = 'queued' OR workerId = @workerId OR workerId = '' OR lockedAt = '' OR lockedAt < @staleBefore)
  `).run({ id: job.id, tenantId: access.tenantId, workerId: worker.workerId, ts, staleBefore });
  return (result.changes || 0) > 0;
}

function heartbeatLargeMigrationJob(jobId, access, workerId) {
  if (!workerId) return;
  const ts = now();
  db.prepare(`
    UPDATE migration_large_jobs
       SET lockedAt = @ts, heartbeatAt = @ts, updatedAt = @ts
     WHERE id = @jobId
       AND tenantId = @tenantId
       AND status = 'processing'
       AND workerId = @workerId
  `).run({ jobId, tenantId: access.tenantId, workerId, ts });
}

function releaseLargeMigrationJob(jobId, worker, access) {
  recomputeLargeJobTotals(jobId, access);
  const job = largeMigrationJob(jobId, access);
  if (!job) return job;
  if (job.workerId && job.workerId !== worker.workerId) return job;
  if (!["processing", "queued"].includes(job.status)) {
    updateDirectRow("migration_large_jobs", jobId, { workerId: "", lockedAt: "", heartbeatAt: "" }, access);
    return largeMigrationJob(jobId, access);
  }
  const remaining = db.prepare(`
    SELECT COUNT(*) AS total
      FROM migration_file_chunks
     WHERE tenantId = @tenantId
       AND jobId = @jobId
       AND status IN ('analyzed', 'analyzed_with_errors', 'failed')
  `).get({ tenantId: access.tenantId, jobId })?.total || 0;
  if (remaining > 0) {
    updateDirectRow("migration_large_jobs", jobId, {
      status: "queued",
      workerId: "",
      lockedAt: "",
      heartbeatAt: "",
      resumeToken: `job:${jobId}:queued:${now()}`
    }, access);
  } else {
    const importedSummary = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('imported_with_errors', 'skipped_with_errors') THEN 1 ELSE 0 END) AS withErrors
      FROM migration_file_chunks
      WHERE tenantId = @tenantId AND jobId = @jobId
        AND status IN ('imported', 'imported_with_errors', 'skipped_with_errors')
    `).get({ tenantId: access.tenantId, jobId }) || { total: 0, withErrors: 0 };
    if (importedSummary.total > 0) {
      updateDirectRow("migration_large_jobs", jobId, {
        status: importedSummary.withErrors > 0 ? "completed_with_errors" : "completed",
        completedAt: now(),
        failureReason: "",
        workerId: "",
        lockedAt: "",
        heartbeatAt: ""
      }, access);
    } else {
      updateDirectRow("migration_large_jobs", jobId, {
        status: "paused",
        failureReason: "No analyzed chunks ready",
        workerId: "",
        lockedAt: "",
        heartbeatAt: ""
      }, access);
    }
  }
  return largeMigrationJob(jobId, access);
}
function workerAccessForJob(job, access = {}) {
  return {
    tenantId: job.tenantId,
    branchId: job.branchId || access.branchId || "",
    requestedBranchId: job.branchId || access.requestedBranchId || access.branchId || "",
    userId: access.userId || "migration-worker",
    role: access.role || "owner",
    branchIds: job.branchId ? [job.branchId] : access.branchIds || [],
    workerId: access.workerId || ""
  };
}
function assertLargeJobReadyForImport(jobId, payload = {}, access) {
  const chunks = db.prepare("SELECT * FROM migration_file_chunks WHERE tenantId = @tenantId AND jobId = @jobId ORDER BY chunkNumber ASC").all({ tenantId: access.tenantId, jobId }).map(deserializeDirectRow);
  if (!chunks.length) throw migrationJobNotReady("Large migration job has no chunks to import.");
  const readyStatuses = new Set(["analyzed", "analyzed_with_errors", "failed"]);
  const closedStatuses = new Set(["imported", "imported_with_errors", "skipped_with_errors", "rolled_back", "cancelled"]);
  const readyChunks = chunks.filter((chunk) => readyStatuses.has(chunk.status));
  const blockingChunks = chunks.filter((chunk) => !readyStatuses.has(chunk.status) && !closedStatuses.has(chunk.status));
  if (blockingChunks.length && payload.allowPartialImport !== true) {
    const numbers = blockingChunks.slice(0, 10).map((chunk) => chunk.chunkNumber).join(", ");
    throw migrationJobNotReady(`Large migration job has ${blockingChunks.length} chunk(s) not analyzed yet (${numbers}). Analyze all chunks or pass allowPartialImport to import only ready chunks.`);
  }
  if (!readyChunks.length) throw migrationJobNotReady("Large migration job has no analyzed chunks ready for import.");
  return { totalChunks: chunks.length, readyChunks: readyChunks.length, blockingChunks: blockingChunks.length };
}
function processLargeJobStagedChunks(jobId, payload, access) {
  const maxChunks = Math.max(1, Math.min(100, integer(payload.maxChunks, 10)));
  const stopOnError = payload.stopOnError !== false;
  const chunks = db.prepare(`
    SELECT * FROM migration_file_chunks
    WHERE tenantId = @tenantId
      AND jobId = @jobId
      AND status IN ('analyzed', 'analyzed_with_errors', 'failed')
    ORDER BY chunkNumber ASC
    LIMIT @limit
  `).all({ tenantId: access.tenantId, jobId, limit: maxChunks }).map(deserializeDirectRow);
  const results = [];
  for (const chunk of chunks) {
    try {
      heartbeatLargeMigrationJob(jobId, access, payload.workerId);
      results.push(importStagedLargeJobChunk(jobId, chunk.chunkNumber, payload, access));
      heartbeatLargeMigrationJob(jobId, access, payload.workerId);
    } catch (error) {
      updateDirectRow("migration_file_chunks", chunk.id, {
        status: "failed",
        failedAt: now(),
        failureReason: error.message || "Chunk import failed"
      }, access);
      updateDirectRow("migration_large_jobs", jobId, {
        status: "failed",
        workerId: "",
        lockedAt: "",
        heartbeatAt: "",
        failedAt: now(),
        failureReason: error.message || "Large migration failed"
      }, access);
      results.push({ chunkNumber: chunk.chunkNumber, ok: false, message: error.message });
      if (stopOnError) break;
    }
  }
  recomputeLargeJobTotals(jobId, access);
  const job = largeMigrationJob(jobId, access);
  return { job, processedChunks: results.length, results };
}

function importStagedLargeJobChunk(jobId, chunkNumber, payload, access) {
  const job = requireLargeMigrationJob(jobId, access);
  const chunk = requireLargeMigrationChunk(jobId, chunkNumber, access);
  if (!["analyzed", "analyzed_with_errors", "failed"].includes(chunk.status)) {
    throw badRequest(`Chunk ${chunk.chunkNumber} must be analyzed before staged import.`);
  }
  const preview = stagedPreviewForChunk(job, chunk, access);
  if (!preview.allRows.length) throw badRequest("No staged rows found for this chunk.");
  const settings = parseJsonField(job.settings, {});
  const allowPartialImport = payload.allowPartialImport === true || settings.allowPartialImport === true || settings.worker?.allowPartialImport === true;
  const gate = migrationApprovalGate(access, preview.summary, approvalIdentityForJob(job, preview.summary));
  const hasCriticalErrors = Number(preview.summary.errorRows || 0) > 0;
  const approvalReady = gate.approved || payload.skipApprovalGate === true;
  if (!approvalReady) {
    throw badRequest("Owner approval required for this exact migration job.");
  }
  if (hasCriticalErrors && !allowPartialImport) {
    throw badRequest(`Final staged chunk import blocked: ${preview.summary.errorRows} critical row(s) present. Enable partial import to skip invalid rows or fix the source.`);
  }
  const batchId = makeId("batch");
  insertMigrationRow("migration_import_batches", {
    id: batchId,
    tenantId: access.tenantId,
    jobId,
    sourceSoftware: job.sourceSoftware,
    resource: job.resource || "auto",
    branchId: job.branchId || access.branchId || "",
    status: "importing",
    summary: preview.summary,
    filters: { branchId: job.branchId || access.branchId || "", resource: job.resource || "auto", chunkNumber: chunk.chunkNumber }
  });
  const importTx = db.transaction(() => importPreviewRows(preview, {
    access,
    batchId,
    jobId,
    sourceSoftware: job.sourceSoftware,
    migrationMode: payload.migrationMode !== false,
    duplicateDecisions: stagedDuplicateDecisions(job.id, chunk.id, access),
    allowPartialImport
  }));
  const result = withBusyRetry(() => importTx());
  const chunkStatus = result.importedRows > 0
    ? (result.errorRows ? "imported_with_errors" : "imported")
    : (allowPartialImport && result.errorRows ? "skipped_with_errors" : "imported");
  const summary = { ...preview.summary, ...result, completedAt: now(), chunkNumber: chunk.chunkNumber };
  updateDirectRow("migration_file_chunks", chunk.id, {
    status: chunkStatus,
    processedRows: preview.summary.totalRows,
    validRows: preview.summary.validRows,
    warningRows: result.warningRows,
    errorRows: result.errorRows,
    importedRows: result.importedRows,
    skippedRows: result.skippedRows,
    summary,
    completedAt: now(),
    failureReason: ""
  }, access);
  updateMigrationRow("migration_import_batches", batchId, { status: result.errorRows ? "completed_with_errors" : "completed", summary }, { tenantId: access.tenantId });
  syncStagingImportResults(job.id, chunk.id, batchId, access);
  recomputeLargeJobTotals(job.id, access);
  auditMigration("migration.large_job.staged_chunk_imported", { jobId, batchId, chunkId: chunk.id, chunkNumber: chunk.chunkNumber, summary }, access);
  return { ok: true, job: largeMigrationJob(jobId, access), batchId, chunk: directChunk(chunk.id, access), summary };
}

function stagedPreviewForChunk(job, chunk, access) {
  const stagedRows = db.prepare(`
    SELECT * FROM migration_staging_rows
    WHERE tenantId = @tenantId AND jobId = @jobId AND chunkId = @chunkId
    ORDER BY sourceRowNumber ASC
  `).all({ tenantId: access.tenantId, jobId: job.id, chunkId: chunk.id }).map(deserializeDirectRow);
  const rows = dependencyOrderedRows(stagedRows.map((row) => ({
    resource: row.resource,
    entity: row.resource,
    sourceSheet: row.sourceSheet,
    sourceRowNumber: row.sourceRowNumber,
    sourceExternalId: row.sourceExternalId,
    status: row.status,
    action: row.action,
    targetId: row.targetId,
    message: row.status === "error" ? (row.errors || []).join(", ") : (row.warnings || []).join(", ") || "Ready to import",
    duplicate: Boolean(row.duplicateKey),
    payload: row.payload || {},
    raw: row.raw || {},
    errors: row.errors || [],
    warnings: row.warnings || []
  })));
  const summary = summarizePreparedRows(rows, job.sourceSoftware, job.fileName, false);
  const response = { sourceSoftware: job.sourceSoftware, fileName: job.fileName, mapping: parseJsonField(job.mapping, {}), unmatchedColumns: [], summary, rows: rows.slice(0, 500) };
  Object.defineProperty(response, "allRows", { value: rows, enumerable: false });
  return response;
}

function summarizePreparedRows(rows, sourceSoftware, fileName, dryRun) {
  const summary = emptySummary(sourceSoftware, fileName, dryRun);
  for (const row of rows) addSummary(summary, row.resource, row);
  summary.affectedRecords = summary.validRows + summary.warningRows;
  summary.byBranch = branchSummary(rows);
  return summary;
}

function stagedDuplicateDecisions(jobId, chunkId, access) {
  const rows = db.prepare(`
    SELECT sourceSheet, sourceRowNumber, sourceExternalId, duplicateKey, duplicateDecision
    FROM migration_staging_rows
    WHERE tenantId = @tenantId AND jobId = @jobId AND chunkId = @chunkId AND duplicateDecision <> ''
  `).all({ tenantId: access.tenantId, jobId, chunkId });
  const decisions = {};
  for (const row of rows) {
    decisions[`${row.sourceSheet}:${row.sourceRowNumber}`] = row.duplicateDecision;
    if (row.sourceExternalId) decisions[row.sourceExternalId] = row.duplicateDecision;
    if (row.duplicateKey) decisions[row.duplicateKey] = row.duplicateDecision;
  }
  return decisions;
}

function syncStagingImportResults(jobId, chunkId, batchId, access) {
  const results = db.prepare(`
    SELECT sourceSheet, sourceRowNumber, sourceExternalId, action, targetId, status
    FROM migration_row_results
    WHERE tenantId = @tenantId AND jobId = @jobId AND batchId = @batchId
  `).all({ tenantId: access.tenantId, jobId, batchId });
  const update = db.prepare(`
    UPDATE migration_staging_rows
       SET action = @action, targetId = @targetId, status = @status, updatedAt = @updatedAt
     WHERE tenantId = @tenantId AND jobId = @jobId AND chunkId = @chunkId
       AND sourceSheet = @sourceSheet AND sourceRowNumber = @sourceRowNumber
  `);
  for (const row of results) {
    update.run({
      tenantId: access.tenantId,
      jobId,
      chunkId,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      action: row.action,
      targetId: row.targetId,
      status: row.status,
      updatedAt: now()
    });
  }
}
function largeChunkPayload(job, payload, rows) {
  return {
    ...payload,
    sourceSoftware: job.sourceSoftware || payload.sourceSoftware,
    resource: job.resource === "auto" ? payload.resource || "auto" : job.resource,
    mapping: payload.mapping || parseJsonField(job.mapping, {}),
    fileName: job.fileName,
    rows
  };
}


function createLargeJobReconciliation(jobId, payload = {}, access) {
  const job = requireLargeMigrationJob(jobId, access);
  const branchId = cleanText(payload.branchId || job.branchId || access.branchId || "");
  const chunks = db.prepare(`
    SELECT status, COUNT(*) AS chunks, COALESCE(SUM(totalRows), 0) AS totalRows,
           COALESCE(SUM(processedRows), 0) AS processedRows,
           COALESCE(SUM(importedRows), 0) AS importedRows,
           COALESCE(SUM(skippedRows), 0) AS skippedRows,
           COALESCE(SUM(errorRows), 0) AS errorRows
      FROM migration_file_chunks
     WHERE tenantId = @tenantId AND jobId = @jobId
     GROUP BY status
  `).all({ tenantId: access.tenantId, jobId });
  const chunkManifest = db.prepare(`
    SELECT chunkNumber, sourceSheet, rowStart, rowEnd, status, totalRows, processedRows,
           importedRows, skippedRows, errorRows, warningRows, checksum, completedAt, failureReason
      FROM migration_file_chunks
     WHERE tenantId = @tenantId AND jobId = @jobId
     ORDER BY chunkNumber ASC
  `).all({ tenantId: access.tenantId, jobId }).map(deserializeDirectRow);
  const staged = db.prepare(`
    SELECT resource, status, COUNT(*) AS rows
      FROM migration_staging_rows
     WHERE tenantId = @tenantId AND jobId = @jobId
     GROUP BY resource, status
  `).all({ tenantId: access.tenantId, jobId });
  const results = db.prepare(`
    SELECT resource, action, status, COUNT(*) AS rows
      FROM migration_row_results
     WHERE tenantId = @tenantId AND jobId = @jobId
     GROUP BY resource, action, status
  `).all({ tenantId: access.tenantId, jobId });
  const idMap = db.prepare(`
    SELECT resource, linkType, COUNT(*) AS rows
      FROM migration_id_map
     WHERE tenantId = @tenantId AND jobId = @jobId
     GROUP BY resource, linkType
  `).all({ tenantId: access.tenantId, jobId });
  const live = liveTargetPresence(jobId, access);
  const expected = {
    job: {
      id: job.id,
      status: job.status,
      sourceSoftware: job.sourceSoftware,
      resource: job.resource,
      totalRows: Number(job.totalRows || 0),
      validRows: Number(job.validRows || 0),
      warningRows: Number(job.warningRows || 0),
      errorRows: Number(job.errorRows || 0),
      importedRows: Number(job.importedRows || 0),
      skippedRows: Number(job.skippedRows || 0)
    },
    chunks: rowsByKey(chunks, "status"),
    chunkManifest: chunkManifest.map(chunkProofLine),
    staged: rowsByPair(staged, "resource", "status"),
    importedTargetIds: Number(idMap.reduce((sum, row) => sum + Number(row.rows || 0), 0))
  };
  const actual = {
    results: rowsByPair(results, "resource", "action"),
    resultStatuses: rowsByPair(results, "resource", "status"),
    idMap: rowsByPair(idMap, "resource", "linkType"),
    live
  };
  const differences = reconciliationDifferences(expected, actual, job, live);
  const snapshot = insertDirectRow("migration_reconciliation_snapshots", {
    id: cleanText(payload.id) || makeId("mrecon"),
    tenantId: access.tenantId,
    jobId,
    branchId,
    snapshotType: cleanText(payload.snapshotType || "post_import"),
    expected,
    actual,
    differences,
    status: differences.length ? "warning" : "passed"
  });
  return snapshot;
}

function chunkProofLine(chunk) {
  return {
    chunkNumber: Number(chunk.chunkNumber || 0),
    sourceSheet: chunk.sourceSheet || "",
    rowStart: Number(chunk.rowStart || 0),
    rowEnd: Number(chunk.rowEnd || 0),
    status: chunk.status || "unknown",
    totalRows: Number(chunk.totalRows || 0),
    processedRows: Number(chunk.processedRows || 0),
    importedRows: Number(chunk.importedRows || 0),
    skippedRows: Number(chunk.skippedRows || 0),
    errorRows: Number(chunk.errorRows || 0),
    warningRows: Number(chunk.warningRows || 0),
    checksum: chunk.checksum || "",
    completedAt: chunk.completedAt || "",
    failureReason: chunk.failureReason || ""
  };
}
function rowsByKey(rows, key) {
  return Object.fromEntries(rows.map((row) => [cleanText(row[key] || "unknown"), Number(row.rows || row.chunks || 0)]));
}

function rowsByPair(rows, left, right) {
  const out = {};
  for (const row of rows) {
    const group = cleanText(row[left] || "unknown");
    const item = cleanText(row[right] || "unknown");
    out[group] = out[group] || {};
    out[group][item] = Number(row.rows || 0);
  }
  return out;
}

function liveTargetPresence(jobId, access) {
  const rows = db.prepare(`
    SELECT resource, targetTable, targetId
      FROM migration_id_map
     WHERE tenantId = @tenantId AND jobId = @jobId AND targetId <> ''
  `).all({ tenantId: access.tenantId, jobId });
  const out = {};
  for (const row of rows) {
    const templateTable = RESOURCE_TEMPLATES[row.resource]?.table || "";
    if (!templateTable || templateTable !== row.targetTable) continue;
    out[row.resource] = out[row.resource] || { mapped: 0, present: 0, missing: 0 };
    out[row.resource].mapped += 1;
    const found = db.prepare(`SELECT id FROM ${templateTable} WHERE tenantId = @tenantId AND id = @id LIMIT 1`).get({ tenantId: access.tenantId, id: row.targetId });
    if (found) out[row.resource].present += 1;
    else out[row.resource].missing += 1;
  }
  return out;
}

function reconciliationDifferences(expected, actual, job, live) {
  const differences = [];
  const resultImported = sumNested(actual.results, ["created", "merged", "linked"]);
  const jobImported = Number(job.importedRows || 0);
  if (jobImported !== resultImported) {
    differences.push({ code: "import_count_mismatch", severity: "warning", expected: jobImported, actual: resultImported, message: "Job imported rows do not match row result created/merged/linked count." });
  }
  const errorResults = sumNested(actual.resultStatuses, ["error"]);
  if (Number(job.errorRows || 0) !== errorResults && errorResults > 0) {
    differences.push({ code: "error_count_mismatch", severity: "critical", expected: Number(job.errorRows || 0), actual: errorResults, message: "Error row count differs from row result errors." });
  }
  for (const [resource, counts] of Object.entries(live)) {
    if (counts.missing > 0) {
      differences.push({ code: "missing_live_targets", severity: "critical", resource, expected: counts.mapped, actual: counts.present, missing: counts.missing, message: "Some mapped target records are missing from live tables." });
    }
  }
  if (Number(job.totalRows || 0) > 0 && Number(job.processedRows || 0) < Number(job.totalRows || 0) && ["completed", "processing"].includes(job.status)) {
    differences.push({ code: "incomplete_processing", severity: "warning", expected: Number(job.totalRows || 0), actual: Number(job.processedRows || 0), message: "Not all source rows have been processed yet." });
  }
  return differences;
}

function sumNested(groups, keys) {
  let total = 0;
  for (const values of Object.values(groups || {})) {
    for (const key of keys) total += Number(values[key] || 0);
  }
  return total;
}
function largeMigrationJob(id, access) {
  const row = db.prepare("SELECT * FROM migration_large_jobs WHERE id = @id AND tenantId = @tenantId").get({ id, tenantId: access.tenantId });
  if (!row) return null;
  const chunks = db.prepare("SELECT * FROM migration_file_chunks WHERE tenantId = @tenantId AND jobId = @jobId ORDER BY chunkNumber ASC").all({ tenantId: access.tenantId, jobId: id }).map(deserializeDirectRow);
  const reconciliations = db.prepare("SELECT * FROM migration_reconciliation_snapshots WHERE tenantId = @tenantId AND jobId = @jobId ORDER BY createdAt DESC LIMIT 20").all({ tenantId: access.tenantId, jobId: id }).map(deserializeDirectRow);
  const base = deserializeDirectRow(row);
  // The GET response must ALWAYS carry analyzer diagnostics so the UI can verify
  // the new analyzer ran. Prefer what recompute persisted on the job summary;
  // otherwise aggregate live from the chunk summaries (fallback for jobs whose
  // summary wasn't re-stamped). Returns null only when chunks truly lack them
  // (i.e. an old-analyzer job), which the UI surfaces as "version missing".
  const diagnostics = base.summary?.diagnostics || aggregateJobDiagnostics(id, access) || null;
  const summary = diagnostics ? { ...(base.summary || {}), diagnostics } : base.summary;
  return { ...base, summary, diagnostics, chunks, reconciliations };
}

function requireLargeMigrationJob(id, access) {
  const job = largeMigrationJob(id, access);
  if (!job) throw badRequest("Large migration job not found.");
  return job;
}

function requireLargeMigrationChunk(jobId, chunkNumber, access) {
  const chunk = db.prepare("SELECT * FROM migration_file_chunks WHERE tenantId = @tenantId AND jobId = @jobId AND chunkNumber = @chunkNumber").get({
    tenantId: access.tenantId,
    jobId,
    chunkNumber: integer(chunkNumber, 0)
  });
  if (!chunk) throw badRequest("Large migration chunk not found.");
  return deserializeDirectRow(chunk);
}

function directChunk(id, access) {
  const chunk = db.prepare("SELECT * FROM migration_file_chunks WHERE tenantId = @tenantId AND id = @id").get({ tenantId: access.tenantId, id });
  return chunk ? deserializeDirectRow(chunk) : null;
}

function replaceStagingRows(jobId, chunkId, chunkNumber, preview, access, duplicateDecisions = {}) {
  const baseRows = preview.allRows || preview.rows || [];
  const columns = ["id", "tenantId", "jobId", "chunkId", "chunkNumber", "resource", "sourceSheet", "sourceRowNumber", "sourceExternalId", "status", "duplicateKey", "duplicateDecision", "payload", "raw", "errors", "warnings", "createdAt", "updatedAt"];
  const insert = db.prepare(`INSERT INTO migration_staging_rows (${columns.join(", ")}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`);
  const del = db.prepare("DELETE FROM migration_staging_rows WHERE tenantId = @tenantId AND jobId = @jobId AND chunkId = @chunkId");
  let attempts = 0;
  const MAX_ATTEMPTS = 5;
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const rows = baseRows.map((row) => directBindData({
      id: makeIdLong("migrow"),
      tenantId: access.tenantId,
      jobId,
      chunkId,
      chunkNumber,
      resource: row.resource,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      sourceExternalId: row.sourceExternalId,
      status: row.status,
      duplicateKey: row.duplicate || /duplicate|already/i.test(String(row.message || "")) ? duplicateKeyFor(row) : "",
      duplicateDecision: duplicateDecisionFor(row, duplicateDecisions),
      payload: row.payload,
      raw: row.raw,
      errors: row.errors || [],
      warnings: row.warnings || [],
      createdAt: now(),
      updatedAt: now()
    }));
    const replaceTx = db.transaction(() => {
      del.run({ tenantId: access.tenantId, jobId, chunkId });
      for (const row of rows) insert.run(row);
    });
    try {
      replaceTx();
      return;
    } catch (err) {
      if (err.message?.includes("UNIQUE constraint failed: migration_staging_rows.id") && attempts < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}

function recomputeLargeJobTotals(jobId, access) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(totalRows), 0) totalRows,
      COALESCE(SUM(processedRows), 0) processedRows,
      COALESCE(SUM(validRows), 0) validRows,
      COALESCE(SUM(warningRows), 0) warningRows,
      COALESCE(SUM(errorRows), 0) errorRows,
      COALESCE(SUM(importedRows), 0) importedRows,
      COALESCE(SUM(skippedRows), 0) skippedRows,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) failedChunks,
      COALESCE(MAX(chunkNumber), 0) currentChunk
    FROM migration_file_chunks
    WHERE tenantId = @tenantId AND jobId = @jobId
  `).get({ tenantId: access.tenantId, jobId });
  const { failedChunks: _failedChunks, ...persistedTotals } = totals;
  const imported = Number(totals.importedRows || 0);
  const processed = Number(totals.processedRows || 0);
  const total = Number(totals.totalRows || 0);
  const errors = Number(totals.errorRows || 0);
  const failedChunks = Number(totals.failedChunks || 0);
  const status = failedChunks > 0
    ? "failed"
    : processed >= total && total > 0
      ? (errors > 0 ? "completed_with_errors" : "completed")
      : processed > 0 ? "processing" : "draft";
  const diagnostics = aggregateJobDiagnostics(jobId, access);
  const summary = diagnostics ? { ...totals, diagnostics } : totals;
  updateDirectRow("migration_large_jobs", jobId, {
    ...persistedTotals,
    status,
    summary,
    resumeToken: `job:${jobId}:chunk:${totals.currentChunk || 0}`,
    completedAt: status === "completed" || status === "completed_with_errors" ? now() : ""
  }, access);
}

// Aggregates per-chunk analyzer diagnostics into a single job-level block so the
// UI can confirm the new analyzer ran (version stamp), see cross-chunk reference
// counts, and verify this is a fresh job (jobId + generatedAt) — not a cached one.
function aggregateJobDiagnostics(jobId, access) {
  const chunkRows = db.prepare(
    "SELECT summary FROM migration_file_chunks WHERE tenantId = @tenantId AND jobId = @jobId"
  ).all({ tenantId: access.tenantId, jobId });
  const diags = chunkRows.map((r) => parseJsonField(r.summary, {})?.diagnostics).filter(Boolean);
  if (!diags.length) return null;
  const sum = (key) => diags.reduce((acc, d) => acc + Number(d[key] || 0), 0);
  return {
    analyzerFixVersion: diags.find((d) => d.analyzerFixVersion)?.analyzerFixVersion || "",
    adapter: diags.find((d) => d.adapter)?.adapter || "",
    sourceSoftware: diags.find((d) => d.sourceSoftware)?.sourceSoftware || "",
    largeMode: true,
    jobId,
    generatedAt: now(),
    crossChunkReferencesLoaded: sum("crossChunkReferencesLoaded"),
    paymentInvoiceUnresolved: sum("paymentInvoiceUnresolved"),
    clientPhoneMissing: sum("clientPhoneMissing")
  };
}

function insertDirectRow(table, data) {
  assertValidMigrationAdminTable(table, "insertDirectRow");
  const ts = now();
  const row = directBindData({ id: data.id || makeIdLong("migrow"), createdAt: ts, updatedAt: ts, ...data });
  const columns = Object.keys(row);
  assertValidColumnNames(columns);
  const placeholders = columns.map((column) => `@${column}`);
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`).run(row);
  return deserializeDirectRow(row);
}

function updateDirectRow(table, id, data, access) {
  assertValidMigrationAdminTable(table, "updateDirectRow");
  const row = directBindData({ ...data, updatedAt: now() });
  delete row.id;
  delete row.tenantId;
  const keys = Object.keys(row);
  if (!keys.length) return null;
  assertValidColumnNames(keys);
  const params = { ...row, id, tenantId: access.tenantId };
  db.prepare(`UPDATE ${table} SET ${keys.map((key) => `${key} = @${key}`).join(", ")} WHERE id = @id AND tenantId = @tenantId`).run(params);
  return params;
}

function directBindData(data = {}) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined).map(([key, value]) => [key, jsonBind(value)]));
}

function deserializeDirectRow(row = {}) {
  return deserializeJson(row, ["mapping", "settings", "summary", "payload", "raw", "errors", "warnings", "expected", "actual", "differences"]);
}

function parseJsonField(value, fallback) {
  try {
    return typeof value === "string" ? JSON.parse(value || "") : value ?? fallback;
  } catch {
    return fallback;
  }
}

function duplicateKeyFor(row) {
  return `${row.resource}:${cleanText(row.sourceExternalId || row.payload?.phone || row.payload?.email || row.payload?.name || row.sourceRowNumber).toLowerCase()}`;
}

function duplicateDecisionFor(row, decisions = {}) {
  const keys = [`${row.sourceSheet}:${row.sourceRowNumber}`, row.sourceExternalId, duplicateKeyFor(row)].filter(Boolean);
  const value = keys.map((key) => cleanKey(decisions[key])).find(Boolean) || "";
  return ["merge", "keep", "link", "skip"].includes(value) ? value : "";
}

function mergeImportedClient(existing, payload, meta, access) {
  const next = { ...meta };
  for (const key of ["name", "phone", "email", "gender", "birthday", "anniversary", "branchId"]) {
    if (empty(existing[key]) && !empty(payload[key])) next[key] = payload[key];
  }
  const existingNotes = cleanText(existing.notes);
  const incomingNotes = cleanText(payload.notes);
  if (incomingNotes && !existingNotes.includes(incomingNotes)) next.notes = [existingNotes, incomingNotes].filter(Boolean).join(" | ");
  return updateRow("clients", existing.id, next, { tenantId: access.tenantId });
}

function recordMigrationIdMap(row, result, options) {
  if (!result?.targetId || !["created", "merged", "linked"].includes(result.action)) return;
  const sourceExternalId = cleanText(row.sourceExternalId);
  if (!sourceExternalId) return;
  try {
    insertDirectRow("migration_id_map", {
      tenantId: options.access.tenantId,
      jobId: options.jobId || "",
      sourceSoftware: options.sourceSoftware || "",
      resource: row.resource,
      sourceExternalId,
      targetId: result.targetId,
      targetTable: RESOURCE_TEMPLATES[row.resource]?.table || row.resource,
      branchId: row.payload?.branchId || options.access.branchId || "",
      linkType: result.action,
      confidence: result.action === "linked" ? 95 : 100
    });
  } catch {
    // Id-map is useful for relationships, but duplicate map writes must not fail the import transaction.
  }
}
function deserializeJson(row, keys) {
  const out = { ...row };
  for (const key of keys) {
    try {
      out[key] = out[key] ? JSON.parse(out[key]) : null;
    } catch {
      out[key] = null;
    }
  }
  return out;
}

function withBusyRetry(fn, attempts = 12) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (!String(error?.message || "").includes("database is locked")) throw error;
      sleepSync(50 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
