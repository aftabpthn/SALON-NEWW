import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { columnsFor, db, insertRow, listRows, updateRow } from "../db.js";
import { securityService } from "./security.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

const SOURCE_ADAPTERS = {
  zenoti: { label: "Zenoti", type: "salon-pos", formats: ["xlsx", "csv"], status: "adapter-ready" },
  salonist: { label: "Salonist", type: "salon-pos", formats: ["xlsx", "csv"], status: "adapter-ready" },
  dingg: { label: "DINGG", type: "salon-pos", formats: ["xlsx", "csv"], status: "adapter-ready" },
  fresha: { label: "Fresha", type: "salon-pos", formats: ["xlsx", "csv"], status: "adapter-ready" },
  tally: { label: "Tally", type: "accounting", formats: ["xlsx", "csv"], status: "scaffold-ready" },
  busy: { label: "Busy", type: "accounting", formats: ["xlsx", "csv"], status: "scaffold-ready" },
  marg: { label: "Marg", type: "inventory-accounting", formats: ["xlsx", "csv"], status: "scaffold-ready" },
  excel: { label: "Generic Excel", type: "spreadsheet", formats: ["xlsx", "xls"], status: "adapter-ready" },
  csv: { label: "Generic CSV", type: "spreadsheet", formats: ["csv"], status: "adapter-ready" },
  manual: { label: "Manual records", type: "manual", formats: ["xlsx", "csv"], status: "adapter-ready" }
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
  originalRecordId: ["id", "code", "external id", "record id", "old id", "legacy id", "customer id", "client id", "invoice id", "bill id"],
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
  paymentMode: ["payment mode", "mode", "paid by", "payment type"],
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
  invoiceNumber: ["invoice number", "invoice no", "bill no", "bill number", "receipt no"],
  saleId: ["sale id", "bill id"],
  invoiceId: ["invoice id"],
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
    fields: ["originalRecordId", "clientId", "clientName", "clientPhone", "staffId", "staffName", "branchId", "branchName", "serviceName", "lineItem", "subtotal", "discount", "gstAmount", "total", "status", "createdAt"]
  },
  invoices: {
    table: "invoices",
    required: ["invoiceNumber", "clientId", "total"],
    fields: ["originalRecordId", "invoiceNumber", "clientId", "clientName", "clientPhone", "staffId", "staffName", "branchId", "branchName", "subtotal", "discount", "gstAmount", "total", "paid", "balance", "status", "createdAt"]
  },
  payments: {
    table: "payments",
    required: ["invoiceId", "mode", "amount"],
    fields: ["originalRecordId", "invoiceId", "invoiceNumber", "mode", "amount", "reference", "branchId", "branchName", "createdAt"]
  }
};

export const migrationService = {
  adapters() {
    return SOURCE_ADAPTERS;
  },

  templates(resource = "") {
    if (resource) return templateFor(resource);
    return Object.fromEntries(Object.keys(RESOURCE_TEMPLATES).map((key) => [key, templateFor(key)]));
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
      settings: importSettings({ ...payload, sourceSoftware }),
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

  retryFailedLargeJobChunks(jobId, payload, access) {
    requireLargeMigrationJob(jobId, access);
    const reset = resetFailedLargeJobChunks(jobId, access, payload);
    recomputeLargeJobTotals(jobId, access);
    updateDirectRow("migration_large_jobs", jobId, {
      status: reset ? "queued" : "paused",
      workerId: "",
      lockedAt: "",
      heartbeatAt: "",
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
  startLargeJob(jobId, payload, access) {
    requireLargeMigrationJob(jobId, access);
    updateDirectRow("migration_large_jobs", jobId, { status: "processing", workerId: "", lockedAt: "", heartbeatAt: "", startedAt: now(), failureReason: "" }, access);
    const result = processLargeJobStagedChunks(jobId, payload, access);
    auditMigration("migration.large_job.started", { jobId, result }, access);
    return result;
  },

  resumeLargeJob(jobId, payload, access) {
    requireLargeMigrationJob(jobId, access);
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
      checksum: cleanText(payload.checksum || ""),
      payloadRef: cleanText(payload.payloadRef || ""),
      summary: payload.summary || { totalRows }
    };
    if (existing) updateDirectRow("migration_file_chunks", id, row, access);
    else insertDirectRow("migration_file_chunks", row);
    recomputeLargeJobTotals(job.id, access);
    auditMigration("migration.large_job.chunk_registered", { jobId, chunkId: id, chunkNumber, totalRows }, access);
    return largeMigrationJob(jobId, access);
  },

  analyzeLargeJobChunk(jobId, chunkNumber, payload, access) {
    const job = requireLargeMigrationJob(jobId, access);
    const chunk = requireLargeMigrationChunk(jobId, chunkNumber, access);
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
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw badRequest("rows are required for chunk import.");
    const preview = previewPayload(largeChunkPayload(job, payload, rows), access, { persist: false, dryRun: false, jobId: job.id });
    const gate = migrationApprovalGate(access, preview.summary);
    if ((!gate.allowed || preview.summary.errorRows) && payload.skipApprovalGate !== true) {
      throw badRequest(`Final chunk import blocked: ${gate.reason}`);
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
      duplicateDecisions: payload.duplicateDecisions || {}
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
    updateMigrationRow("migration_import_batches", batchId, { status: "completed", summary }, { tenantId: access.tenantId });
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
    const record = {
      id,
      tenantId: access.tenantId,
      branchId: payload.branchId || access.branchId || "",
      jobId: payload.jobId || "",
      resource: payload.resource || "",
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
        (id, tenantId, branchId, jobId, resource, status, note, summaryJson, submittedBy, submittedAt, reviewedBy, reviewedAt, createdAt, updatedAt)
       VALUES
        (@id, @tenantId, @branchId, @jobId, @resource, @status, @note, @summaryJson, @submittedBy, @submittedAt, @reviewedBy, @reviewedAt, @createdAt, @updatedAt)`
    ).run(record);
    auditMigration("migration.approval.submitted", { jobId: record.jobId, approvalId: id }, access);
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
      importedRecordsCount: importedRecords,
      ...clientTotals,
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
    const precheck = this.canImport(payload, access);
    if (!precheck.allowed && payload.skipApprovalGate !== true) {
      throw badRequest(`Final import blocked: ${precheck.blocked.join(", ")}`);
    }
    const preview = previewPayload(payload, access, { persist: false, dryRun: false });
    const sourceSoftware = sourceKey(payload.sourceSoftware);
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
      settings: importSettings(payload),
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
      approvalGate: migrationApprovalGate(access, preview.summary),
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
    const gate = migrationApprovalGate(access, preview.summary);
    const mappingReady = requiredMappingComplete(payload.mapping || {}, payload.resource || "");
    const blocked = [];
    if (Number(preview.summary.errorRows || 0) > 0) blocked.push("critical_errors_present");
    if (!gate.approved) blocked.push("owner_approval_required");
    if (!mappingReady) blocked.push("required_mapping_incomplete");
    return {
      allowed: blocked.length === 0,
      blocked,
      approvalGate: gate,
      mappingReady,
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

function migrationApprovalGate(access = {}, summary = {}) {
  ensureMigrationApprovalSchema();
  const approved = Boolean(db
    .prepare("SELECT id FROM migration_approvals WHERE tenantId = ? AND status = 'approved' ORDER BY createdAt DESC LIMIT 1")
    .get(access.tenantId));
  const hasErrors = Number(summary.errorRows || 0) > 0;
  return {
    approved,
    allowed: approved && !hasErrors,
    reason: hasErrors ? "critical_errors_present" : approved ? "approved" : "owner_approval_required"
  };
}

function requiredMappingComplete(mapping = {}, resource = "") {
  const canonical = canonicalResource(resource || "clients") || "clients";
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


function previewPayload(payload, access, { persist, dryRun, jobId = "" }) {
  const parsed = parsePayload(payload);
  const sourceSoftware = sourceKey(payload.sourceSoftware);
  const normalized = normalizeParsedRows(parsed, payload, access, sourceSoftware);
  const context = createContext(access, normalized);
  const summary = emptySummary(sourceSoftware, parsed.fileName, dryRun);
  const relationJobId = jobId || cleanText(payload.jobId);
  const seen = new Set();
  const rows = normalized.map((row) => {
    const resolved = { ...row, payload: resolveMigrationRelations(row.payload, row, { access, jobId: relationJobId }) };
    const checked = validatePreparedRow(resolved, context, seen);
    addSummary(summary, resolved.resource, checked);
    return { ...resolved, ...checked, sourceSoftware };
  });
  summary.affectedRecords = summary.validRows + summary.warningRows;
  summary.byBranch = branchSummary(rows);
  const response = {
    sourceSoftware,
    fileName: parsed.fileName,
    mapping: normalized.mapping || {},
    unmatchedColumns: normalized.unmatchedColumns || [],
    summary,
    rows: rows.slice(0, 500)
  };
  Object.defineProperty(response, "allRows", { value: rows, enumerable: false });
  if (persist) persistPreview(response, access, dryRun);
  auditMigration(dryRun ? "migration.dry_run.completed" : "migration.preview.completed", { summary }, access);
  return response;
}

function parsePayload(payload = {}) {
  if (Array.isArray(payload.rows)) {
    return {
      fileName: payload.fileName || "manual-records",
      sheets: [{ name: payload.resource || "clients", rows: payload.rows }]
    };
  }
  if (!payload.fileBase64) throw badRequest("fileBase64 or rows is required.");
  const base64 = String(payload.fileBase64).includes(",") ? String(payload.fileBase64).split(",").pop() : payload.fileBase64;
  const workbook = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", cellDates: true, raw: false });
  return {
    fileName: payload.fileName || "migration.xlsx",
    sheets: workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false })
    }))
  };
}

function normalizeParsedRows(parsed, payload, access, sourceSoftware) {
  const allMappings = {};
  const allUnmatched = [];
  const rows = parsed.sheets.flatMap((sheet) => {
    const resource = canonicalResource(payload.resource || detectResource(sheet.name));
    if (!resource) return [];
    const columns = Object.keys(sheet.rows[0] || {});
    const auto = autoMapColumns(columns, resource);
    const mapping = mergeMapping(auto.mapping, payload.mapping || {}, columns, resource);
    allMappings[sheet.name] = mapping;
    allUnmatched.push(...auto.unmatched.filter((column) => !mapping[column]));
    return sheet.rows
      .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""))
      .map((raw, index) => prepareRow({ raw, mapping, resource, sourceSheet: sheet.name, sourceRowNumber: index + 2, access, sourceSoftware }));
  });
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
function prepareRow({ raw, mapping, resource, sourceSheet, sourceRowNumber, access, sourceSoftware }) {
  const fields = {};
  for (const [column, field] of Object.entries(mapping)) {
    if (!field || field === "__ignore") continue;
    fields[field] = raw[column];
  }
  const branchId = resolveBranchId(fields, access);
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
    return {
      productId: cleanText(fields.productId),
      productName: cleanText(fields.productName),
      sku: cleanText(fields.sku),
      branchId,
      type: cleanText(fields.type) || "import_opening_stock",
      quantity: numberValue(fields.quantity ?? fields.stock, 0),
      unitCost: money(fields.unitCost),
      totalCost: numberValue(fields.quantity ?? fields.stock, 0) * money(fields.unitCost),
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
    return {
      clientId: cleanText(fields.clientId),
      clientName: cleanText(fields.clientName),
      clientPhone: normalizePhone(fields.clientPhone || fields.phone),
      staffId: cleanText(fields.staffId),
      staffName: cleanText(fields.staffName),
      branchId,
      serviceIds: splitList(fields.serviceIds || fields.serviceId),
      serviceName: cleanText(fields.serviceName),
      startAt: dateValue(fields.startAt || fields.createdAt),
      endAt: dateValue(fields.endAt),
      status: cleanText(fields.status) || "completed",
      source: cleanText(fields.source) || "migration",
      chair: cleanText(fields.chair),
      notes: cleanText(fields.notes),
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
    if (empty(payload[required])) errors.push(`${required} is required`);
  }
  if (payload.branchId && !context.branches.some((branch) => branch.id === payload.branchId)) errors.push(`Unknown branchId ${payload.branchId}`);
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
    if (payload.clientName || payload.clientPhone) warnings.push("Client will be auto-created from migrated history");
    else errors.push("Client reference could not be resolved");
  }
  if (row.resource === "appointments" && !resolveStaff(payload, context)) errors.push("Staff reference could not be resolved");
  if (row.resource === "inventory" && !resolveProduct(payload, context)) errors.push("Product reference could not be resolved");
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
    } else {
      try {
        result = importOne(row, { ...options, context });
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
    return { action: "created", targetId: created.id, status: row.status, message: "Staff imported" };
  }
  if (row.resource === "services") {
    const existing = context.services.find((item) => same(item.name, payload.name));
    if (existing) return { action: "skipped", targetId: existing.id, status: "warning", message: "Service already exists" };
    const created = insertRow("services", { ...payload, ...meta });
    context.services.push(created);
    return { action: "created", targetId: created.id, status: row.status, message: "Service imported" };
  }
  if (row.resource === "products") {
    const existing = context.products.find((item) => same(item.sku, payload.sku) && item.branchId === payload.branchId);
    if (existing) return { action: "skipped", targetId: existing.id, status: "warning", message: "Product already exists" };
    const created = insertRow("products", { ...payload, ...meta });
    context.products.push(created);
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
    const staff = resolveStaff(payload, context);
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
    return { action: "created", targetId: sale.id, status: row.status, message: "Sale imported" };
  }
  if (row.resource === "invoices") {
    const invoice = createImportedInvoice(payload, context, access, meta);
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
  const existing = context.invoices.find((invoice) => same(invoice.invoiceNumber, payload.invoiceNumber));
  if (existing) {
    const error = new Error(`Invoice number already exists: ${payload.invoiceNumber}`);
    error.status = 409;
    throw error;
  }
  const sale = payload.saleId ? context.sales.find((item) => item.id === payload.saleId) : createImportedSale(payload, context, access, meta);
  const paid = payload.balance === undefined ? money(payload.paid) : Math.max(0, money(payload.total) - money(payload.balance));
  const balance = payload.balance === undefined ? Math.max(0, money(payload.total) - paid) : money(payload.balance);
  const invoice = insertRow("invoices", {
    saleId: sale.id,
    clientId: sale.clientId,
    invoiceNumber: payload.invoiceNumber || `MIG-${sale.id.slice(-8).toUpperCase()}`,
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
  return invoice;
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
  const result = db.prepare(`DELETE FROM ${table} WHERE ${where.join(" AND ")}`).run(params);
  return result.changes || 0;
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
  const context = { access, branches, clients, staff, services, products, vendors, invoices, sales };
  context.clientIndex = { phone: new Map(), email: new Map(), name: new Map() };
  for (const client of clients) indexClientRecord(context, client);
  return context;
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
function resolveBranchId(fields, access) {
  const explicit = cleanText(fields.branchId);
  if (explicit) return explicit;
  const branchName = cleanText(fields.branchName);
  if (branchName) {
    const branch = listRows("branches", { tenantId: access.tenantId, limit: 1000 }).find((row) => same(row.name, branchName) || same(row.city, branchName));
    if (branch) return branch.id;
  }
  return access.branchId || access.branchIds?.[0] || "branch_hyd";
}

function resolveClient(payload, context) {
  return payload.clientId ? context.clients.find((client) => client.id === payload.clientId) : findClient(payload, context);
}

function ensureClient(payload, context, access, meta) {
  const existing = resolveClient(payload, context);
  if (existing) return existing;
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
    ...meta
  });
  context.clients.push(created);
  indexClientRecord(context, created);
  return created;
}

function indexClientRecord(context, client) {
  if (!context.clientIndex) return;
  const phone = normalizePhone(client.phone);
  const email = cleanText(client.email).toLowerCase();
  const name = cleanText(client.name).toLowerCase();
  if (phone && !context.clientIndex.phone.has(phone)) context.clientIndex.phone.set(phone, client);
  if (email && !context.clientIndex.email.has(email)) context.clientIndex.email.set(email, client);
  if (name && !context.clientIndex.name.has(name)) context.clientIndex.name.set(name, client);
}

function findClient(payload, context, options = {}) {
  const phone = normalizePhone(payload.phone || payload.clientPhone);
  const email = cleanText(payload.email).toLowerCase();
  const name = cleanText(payload.name || payload.clientName).toLowerCase();
  const originalRecordId = cleanText(payload.originalRecordId || payload.sourceExternalId);
  const branchId = cleanText(payload.branchId);
  const candidates = context.clients.filter((client) => sameClientBranch(client, branchId));
  const strongMatch = candidates.find((client) =>
    (originalRecordId && same(client.originalRecordId, originalRecordId)) ||
    (phone && normalizePhone(client.phone) === phone) ||
    (email && cleanText(client.email).toLowerCase() === email)
  );
  if (strongMatch || options.strongOnly) return strongMatch;
  return candidates.find((client) =>
    (name && cleanText(client.name).toLowerCase() === name)
  );
}

function sameClientBranch(client, branchId) {
  return !branchId || !client.branchId || client.branchId === branchId;
}

function resolveStaff(payload, context) {
  if (payload.staffId) return context.staff.find((staff) => staff.id === payload.staffId);
  if (payload.staffName) return context.staff.find((staff) => same(staff.name, payload.staffName));
  return null;
}

function resolveProduct(payload, context) {
  if (payload.productId) return context.products.find((product) => product.id === payload.productId);
  if (payload.sku) return context.products.find((product) => same(product.sku, payload.sku) && (!payload.branchId || product.branchId === payload.branchId));
  if (payload.productName) return context.products.find((product) => same(product.name, payload.productName) && (!payload.branchId || product.branchId === payload.branchId));
  return null;
}

function resolveInvoice(payload, context) {
  if (payload.invoiceId) return context.invoices.find((invoice) => invoice.id === payload.invoiceId);
  if (payload.invoiceNumber) return context.invoices.find((invoice) => same(invoice.invoiceNumber, payload.invoiceNumber) && invoice.id);
  return null;
}

function resolveServiceIds(payload, context) {
  const ids = Array.isArray(payload.serviceIds) ? payload.serviceIds : [];
  const resolved = ids.filter((id) => context.services.some((service) => service.id === id));
  if (payload.serviceName) {
    const service = context.services.find((item) => same(item.name, payload.serviceName));
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
function ensureMigrationApprovalSchema() {
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
      updatedAt TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureMigrationApprovalColumns();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_migration_approvals_scope
      ON migration_approvals (tenantId, status, createdAt);
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
    ["updatedAt", "TEXT NOT NULL DEFAULT ''"]
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

function importSettings(payload) {
  return {
    migrationMode: payload.migrationMode !== false,
    preserveCreatedAt: true,
    preserveInvoiceNumbers: true,
    preserveHistoricalPayments: true,
    partialFailureHandling: "row-level",
    originalSystem: payload.sourceSoftware || "excel",
    sandboxMode: payload.sandboxMode !== false,
    duplicateDecisions: payload.duplicateDecisions || {},
    approvalGate: payload.skipApprovalGate === true ? "skipped_by_admin" : "required"
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
  const where = ["tenantId = @tenantId", "jobId = @jobId", "status IN ('failed', 'imported_with_errors')"];
  const params = { tenantId: access.tenantId, jobId, ts: now() };
  if (chunkNumber) {
    where.push("chunkNumber = @chunkNumber");
    params.chunkNumber = chunkNumber;
  }
  const result = db.prepare(`
    UPDATE migration_file_chunks
       SET status = CASE WHEN errorRows > 0 THEN 'analyzed_with_errors' ELSE 'analyzed' END,
           failureReason = '', failedAt = '', updatedAt = @ts
     WHERE ${where.join(" AND ")}
  `).run(params);
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
    const worker = { ...settings.worker, ...payload, workerId, lockTimeoutMs, workerTick: true };
    if (!claimLargeMigrationJob(job, worker, jobAccess)) {
      results.push({ jobId: job.id, ok: false, claimed: false, status: job.status });
      continue;
    }
    try {
      const result = processLargeJobStagedChunks(job.id, worker, jobAccess);
      const releasedJob = releaseLargeMigrationJob(job.id, worker, jobAccess);
      results.push({ jobId: job.id, ok: true, claimed: true, processedChunks: result.processedChunks, status: releasedJob?.status || result.job?.status || "processing" });
    } catch (error) {
      updateDirectRow("migration_large_jobs", job.id, {
        status: "failed",
        workerId: "",
        lockedAt: "",
        heartbeatAt: "",
        failedAt: now(),
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
    updateDirectRow("migration_large_jobs", jobId, {
      status: "paused",
      failureReason: "No analyzed chunks ready",
      workerId: "",
      lockedAt: "",
      heartbeatAt: ""
    }, access);
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
  const gate = migrationApprovalGate(access, preview.summary);
  if ((!gate.allowed || preview.summary.errorRows) && payload.skipApprovalGate !== true) {
    throw badRequest(`Final staged chunk import blocked: ${gate.reason}`);
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
    duplicateDecisions: stagedDuplicateDecisions(job.id, chunk.id, access)
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
  updateMigrationRow("migration_import_batches", batchId, { status: "completed", summary }, { tenantId: access.tenantId });
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
  return { ...deserializeDirectRow(row), chunks, reconciliations };
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
  db.prepare("DELETE FROM migration_staging_rows WHERE tenantId = @tenantId AND jobId = @jobId AND chunkId = @chunkId").run({ tenantId: access.tenantId, jobId, chunkId });
  for (const row of preview.allRows || preview.rows || []) {
    insertDirectRow("migration_staging_rows", {
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
      warnings: row.warnings || []
    });
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
      COALESCE(MAX(chunkNumber), 0) currentChunk
    FROM migration_file_chunks
    WHERE tenantId = @tenantId AND jobId = @jobId
  `).get({ tenantId: access.tenantId, jobId });
  const imported = Number(totals.importedRows || 0);
  const processed = Number(totals.processedRows || 0);
  const total = Number(totals.totalRows || 0);
  const status = imported > 0 && processed >= total && total > 0 ? "completed" : processed > 0 ? "processing" : "draft";
  updateDirectRow("migration_large_jobs", jobId, {
    ...totals,
    status,
    summary: totals,
    resumeToken: `job:${jobId}:chunk:${totals.currentChunk || 0}`,
    completedAt: status === "completed" ? now() : ""
  }, access);
}

function insertDirectRow(table, data) {
  const ts = now();
  const row = directBindData({ id: data.id || makeId("migrow"), createdAt: ts, updatedAt: ts, ...data });
  const columns = Object.keys(row);
  const placeholders = columns.map((column) => `@${column}`);
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`).run(row);
  return deserializeDirectRow(row);
}

function updateDirectRow(table, id, data, access) {
  const row = directBindData({ ...data, updatedAt: now() });
  delete row.id;
  delete row.tenantId;
  const keys = Object.keys(row);
  if (!keys.length) return null;
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







