import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPaths = [
  join(__dirname, "..", "db", "migrations", "20260521_staff_operating_system.sql"),
  join(__dirname, "..", "db", "migrations", "20260522_staff_os_advanced_modules.sql"),
  join(__dirname, "..", "db", "migrations", "20260522_ai_workforce_command_center.sql"),
  join(__dirname, "..", "db", "migrations", "20260522_autonomous_enterprise_platform.sql"),
  join(__dirname, "..", "db", "migrations", "20260523_inventory_enterprise.sql"),
  join(__dirname, "..", "db", "migrations", "20260523_membership_enterprise.sql"),
  join(__dirname, "..", "db", "migrations", "20260529_membership_self_service.sql"),
  join(__dirname, "..", "db", "migrations", "20260529_membership_enterprise_controls.sql"),
  join(__dirname, "..", "db", "migrations", "20260529_staff_enterprise_os_foundation.sql"),
  join(__dirname, "..", "db", "migrations", "20260529_staff_categories.sql"),
  join(__dirname, "..", "db", "migrations", "20260529_staff_employee_details.sql"),
  join(__dirname, "..", "db", "migrations", "20260530_staff_master_definitions.sql"),
  join(__dirname, "..", "db", "migrations", "20260530_staff_attendance_targets.sql"),
  join(__dirname, "..", "db", "migrations", "20260531_staff_master_payroll_services.sql"),
  join(__dirname, "..", "db", "migrations", "20260602_staff_attendance_biometric_camera.sql"),
  join(__dirname, "..", "db", "migrations", "20260602_staff_attendance_future_intelligence.sql")
];

let ensured = false;

export function ensureStaffOsSchema() {
  if (ensured) return;
  for (const migrationPath of migrationPaths) {
    const migration = readFileSync(migrationPath, "utf8");
    db.exec(migration);
  }
  ensureLegacyStaffManagementTables();
  ensureColumn("staff", "image", "TEXT DEFAULT ''");
  ensureColumn("warehouse_snapshots", "tenant_id", "TEXT NOT NULL DEFAULT 'tenant_aura'");
  ensureColumn("warehouse_snapshots", "branch_id", "TEXT DEFAULT ''");
  ensureColumn("warehouse_snapshots", "snapshot_type", "TEXT DEFAULT ''");
  ensureColumn("warehouse_snapshots", "snapshot_json", "TEXT DEFAULT '{}'");
  ensureColumn("warehouse_snapshots", "created_at", "TEXT");
  ensureColumn("barcode_scan_events", "code", "TEXT DEFAULT ''");
  ensureColumn("barcode_scan_events", "scan_type", "TEXT DEFAULT 'lookup'");
  ensureColumn("barcode_scan_events", "matched_product_id", "TEXT DEFAULT ''");
  ensureColumn("barcode_scan_events", "result_json", "TEXT DEFAULT '{}'");
  ensureColumn("barcode_scan_events", "terminal_id", "TEXT DEFAULT ''");
  ensureColumn("barcode_scan_events", "scanned_code", "TEXT DEFAULT ''");
  ensureColumn("barcode_scan_events", "resolved_entity_type", "TEXT DEFAULT ''");
  ensureColumn("barcode_scan_events", "resolved_entity_id", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "subtotal_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "discount_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "taxable_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "gst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "cgst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "sgst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "igst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "round_off", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "grand_total", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "expected_delivery_date", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "supplier_invoice_no", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "supplier_invoice_date", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "challan_no", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "grn_number", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "grn_date", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "received_by", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "approval_note", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "rejection_reason", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "payment_terms", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "delivery_terms", "TEXT DEFAULT ''");
  ensureColumn("purchase_orders", "variance_json", "TEXT DEFAULT '[]'");
  ensureColumn("purchase_orders", "status_history_json", "TEXT DEFAULT '[]'");
  ensureColumn("purchase_order_items", "hsn_sac", "TEXT DEFAULT ''");
  ensureColumn("purchase_order_items", "unit", "TEXT DEFAULT 'pcs'");
  ensureColumn("purchase_order_items", "mrp", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "discount_percent", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "discount_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "gst_percent", "REAL DEFAULT 18");
  ensureColumn("purchase_order_items", "taxable_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "gst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "cgst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "sgst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "igst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "line_total", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "received_taxable_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "received_gst_amount", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "damaged_qty", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "short_qty", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "excess_qty", "REAL DEFAULT 0");
  ensureColumn("purchase_order_items", "variance_json", "TEXT DEFAULT '[]'");
  ensureColumn("service_recipes", "service_category", "TEXT DEFAULT ''");
  ensureColumn("service_recipes", "service_price", "REAL DEFAULT 0");
  ensureColumn("service_recipes", "expected_margin", "REAL DEFAULT 0");
  ensureColumn("service_recipes", "expected_margin_pct", "REAL DEFAULT 0");
  ensureColumn("service_recipes", "margin_floor_pct", "REAL DEFAULT 0");
  ensureColumn("service_recipes", "approval_status", "TEXT DEFAULT 'approved'");
  ensureColumn("service_recipes", "approved_by", "TEXT DEFAULT ''");
  ensureColumn("service_recipes", "approved_at", "TEXT");
  ensureColumn("service_recipes", "submitted_by", "TEXT DEFAULT ''");
  ensureColumn("service_recipes", "submitted_at", "TEXT");
  ensureColumn("service_recipes", "usage_modifiers_json", "TEXT DEFAULT '[]'");
  ensureColumn("service_recipes", "substitute_policy_json", "TEXT DEFAULT '{}'");
  ensureColumn("service_recipes", "ai_suggestion_json", "TEXT DEFAULT '{}'");
  ensureColumn("service_recipes", "version_note", "TEXT DEFAULT ''");
  ensureColumn("service_recipes", "last_consumed_at", "TEXT");
  ensureColumn("service_recipe_items", "product_type", "TEXT DEFAULT ''");
  ensureColumn("service_recipe_items", "unit", "TEXT DEFAULT 'pcs'");
  ensureColumn("service_recipe_items", "min_quantity_per_service", "REAL DEFAULT 0");
  ensureColumn("service_recipe_items", "max_quantity_per_service", "REAL DEFAULT 0");
  ensureColumn("service_recipe_items", "required", "INTEGER DEFAULT 1");
  ensureColumn("service_recipe_items", "sort_order", "INTEGER DEFAULT 0");
  ensureColumn("service_recipe_items", "allowed_substitutes_json", "TEXT DEFAULT '[]'");
  ensureColumn("service_recipe_items", "actual_tracking_mode", "TEXT DEFAULT 'expected'");
  ensureColumn("service_recipe_items", "ai_confidence", "REAL DEFAULT 0");
  ensureColumn("staff_shift_templates", "short_code", "TEXT DEFAULT ''");
  ensureColumn("staff_shift_templates", "description", "TEXT DEFAULT ''");
  ensureColumn("staff_shift_templates", "shift_type", "TEXT DEFAULT 'regular'");
  ensureColumn("staff_shift_templates", "hide", "INTEGER DEFAULT 0");
  ensureColumn("staff_shift_templates", "version", "INTEGER DEFAULT 1");
  ensureColumn("staff_shift_templates", "created_by", "TEXT DEFAULT ''");
  ensureColumn("staff_shift_templates", "updated_at", "TEXT DEFAULT ''");
  ensureColumn("staff_fine_penalty_master", "amount_paise", "INTEGER DEFAULT 0");
  ensureColumn("staff_fine_penalty_master", "rule_type", "TEXT DEFAULT 'manual'");
  ensureColumn("staff_fine_penalty_master", "rule_label", "TEXT DEFAULT ''");
  ensureColumn("staff_fine_penalty_master", "trigger_count", "REAL DEFAULT 1");
  ensureColumn("staff_fine_penalty_master", "apply_mode", "TEXT DEFAULT 'per_occurrence'");
  ensureColumn("staff_fine_penalty_master", "auto_deduct", "INTEGER DEFAULT 1");
  ensured = true;
  logger.info("staff_os_schema_ensured", {
    migrations: migrationPaths.map((migrationPath) => migrationPath.split(/[\\/]/).pop())
  });
}

function ensureLegacyStaffManagementTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_biometric_events (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      staffId TEXT NOT NULL,
      deviceId TEXT DEFAULT '',
      employeeCode TEXT DEFAULT '',
      eventType TEXT DEFAULT '',
      eventAt TEXT DEFAULT '',
      attendanceId TEXT DEFAULT '',
      status TEXT DEFAULT 'accepted',
      source TEXT DEFAULT '',
      payload TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_leave_requests (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      staffId TEXT NOT NULL,
      leaveType TEXT DEFAULT 'paid',
      startDate TEXT NOT NULL,
      endDate TEXT DEFAULT '',
      days REAL DEFAULT 1,
      status TEXT DEFAULT 'pending',
      reason TEXT DEFAULT '',
      decisionReason TEXT DEFAULT '',
      approvedBy TEXT DEFAULT '',
      history TEXT DEFAULT '[]',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_payroll_components (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      staffId TEXT NOT NULL,
      periodStart TEXT DEFAULT '',
      periodEnd TEXT DEFAULT '',
      basic REAL DEFAULT 0,
      hra REAL DEFAULT 0,
      allowances REAL DEFAULT 0,
      deductions REAL DEFAULT 0,
      pf REAL DEFAULT 0,
      esi REAL DEFAULT 0,
      tds REAL DEFAULT 0,
      pt REAL DEFAULT 0,
      grossPay REAL DEFAULT 0,
      netPay REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      approvedBy TEXT DEFAULT '',
      components TEXT DEFAULT '{}',
      deductionsBreakup TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_commission_rules (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      staffId TEXT NOT NULL,
      name TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      servicePercent REAL DEFAULT 0,
      productPercent REAL DEFAULT 0,
      membershipPercent REAL DEFAULT 0,
      packagePercent REAL DEFAULT 0,
      flatAmount REAL DEFAULT 0,
      targetBonus REAL DEFAULT 0,
      slabs TEXT DEFAULT '[]',
      rules TEXT DEFAULT '{}',
      approvedBy TEXT DEFAULT '',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_notifications (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      staffId TEXT NOT NULL,
      type TEXT DEFAULT '',
      channel TEXT DEFAULT 'whatsapp',
      title TEXT DEFAULT '',
      body TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      payload TEXT DEFAULT '{}',
      copiedAt TEXT DEFAULT '',
      approvedAt TEXT DEFAULT '',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_branch_transfers (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      staffId TEXT NOT NULL,
      fromBranchId TEXT DEFAULT '',
      toBranchId TEXT DEFAULT '',
      effectiveDate TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      approvedBy TEXT DEFAULT '',
      history TEXT DEFAULT '[]',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_approvals (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      staffId TEXT DEFAULT '',
      requestType TEXT DEFAULT '',
      referenceId TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      requestedBy TEXT DEFAULT '',
      approvedBy TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      history TEXT DEFAULT '[]',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const [table, columns] of Object.entries({
    staff_documents: {
      tenant_id: "TEXT DEFAULT 'tenant_aura'",
      staff_id: "TEXT DEFAULT ''",
      document_type: "TEXT DEFAULT ''",
      document_url: "TEXT DEFAULT ''",
      verification_status: "TEXT DEFAULT 'pending'",
      expiry_date: "TEXT DEFAULT ''",
      uploaded_at: "TEXT DEFAULT ''",
      tenantId: "TEXT DEFAULT 'tenant_aura'",
      branchId: "TEXT DEFAULT ''",
      staffId: "TEXT DEFAULT ''",
      documentType: "TEXT DEFAULT ''",
      documentNumber: "TEXT DEFAULT ''",
      status: "TEXT DEFAULT 'pending'",
      issuedAt: "TEXT DEFAULT ''",
      expiresAt: "TEXT DEFAULT ''",
      verifiedBy: "TEXT DEFAULT ''",
      notes: "TEXT DEFAULT ''",
      metadata: "TEXT DEFAULT '{}'",
      createdAt: "TEXT DEFAULT ''",
      updatedAt: "TEXT DEFAULT ''"
    },
    staff_skills: {
      tenant_id: "TEXT DEFAULT 'tenant_aura'",
      staff_id: "TEXT DEFAULT ''",
      service_id: "TEXT DEFAULT ''",
      skill_level: "TEXT DEFAULT 'beginner'",
      years_experience: "REAL DEFAULT 0",
      certified: "INTEGER DEFAULT 0",
      certification_expiry: "TEXT DEFAULT ''",
      created_at: "TEXT DEFAULT ''",
      tenantId: "TEXT DEFAULT 'tenant_aura'",
      branchId: "TEXT DEFAULT ''",
      staffId: "TEXT DEFAULT ''",
      skillName: "TEXT DEFAULT ''",
      level: "TEXT DEFAULT 'beginner'",
      serviceIds: "TEXT DEFAULT '[]'",
      certificationStatus: "TEXT DEFAULT 'pending'",
      certifications: "TEXT DEFAULT '[]'",
      expiresAt: "TEXT DEFAULT ''",
      notes: "TEXT DEFAULT ''",
      createdAt: "TEXT DEFAULT ''",
      updatedAt: "TEXT DEFAULT ''"
    },
    staff_reviews: {
      tenant_id: "TEXT DEFAULT 'tenant_aura'",
      staff_id: "TEXT DEFAULT ''",
      customer_id: "TEXT DEFAULT ''",
      review_text: "TEXT DEFAULT ''",
      sentiment: "TEXT DEFAULT ''",
      created_at: "TEXT DEFAULT ''",
      tenantId: "TEXT DEFAULT 'tenant_aura'",
      branchId: "TEXT DEFAULT ''",
      staffId: "TEXT DEFAULT ''",
      clientId: "TEXT DEFAULT ''",
      appointmentId: "TEXT DEFAULT ''",
      feedback: "TEXT DEFAULT ''",
      complaintFlag: "INTEGER DEFAULT 0",
      rebookingFlag: "INTEGER DEFAULT 0",
      metadata: "TEXT DEFAULT '{}'",
      createdAt: "TEXT DEFAULT ''",
      updatedAt: "TEXT DEFAULT ''"
    }
  })) {
    for (const [column, definition] of Object.entries(columns)) {
      ensureColumn(table, column, definition);
    }
  }

  mirrorColumn("staff_documents", "tenantId", "tenant_id");
  mirrorColumn("staff_documents", "tenant_id", "tenantId");
  mirrorColumn("staff_documents", "staffId", "staff_id");
  mirrorColumn("staff_documents", "staff_id", "staffId");
  mirrorColumn("staff_documents", "documentType", "document_type");
  mirrorColumn("staff_documents", "document_type", "documentType");
  mirrorColumn("staff_documents", "status", "verification_status");
  mirrorColumn("staff_documents", "verification_status", "status");
  mirrorColumn("staff_documents", "expiresAt", "expiry_date");
  mirrorColumn("staff_documents", "expiry_date", "expiresAt");
  mirrorColumn("staff_skills", "tenantId", "tenant_id");
  mirrorColumn("staff_skills", "tenant_id", "tenantId");
  mirrorColumn("staff_skills", "staffId", "staff_id");
  mirrorColumn("staff_skills", "staff_id", "staffId");
  mirrorColumn("staff_skills", "level", "skill_level");
  mirrorColumn("staff_skills", "skill_level", "level");
  mirrorColumn("staff_reviews", "tenantId", "tenant_id");
  mirrorColumn("staff_reviews", "tenant_id", "tenantId");
  mirrorColumn("staff_reviews", "staffId", "staff_id");
  mirrorColumn("staff_reviews", "staff_id", "staffId");
  mirrorColumn("staff_reviews", "clientId", "customer_id");
  mirrorColumn("staff_reviews", "customer_id", "clientId");
  mirrorColumn("staff_reviews", "feedback", "review_text");
  mirrorColumn("staff_reviews", "review_text", "feedback");
}

function ensureColumn(table, column, definition) {
  const columns = getColumns(table);
  if (columns.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function mirrorColumn(table, target, source) {
  const columns = getColumns(table);
  if (!columns.includes(target) || !columns.includes(source)) return;
  db.exec(`
    UPDATE ${quoteIdentifier(table)}
       SET ${quoteIdentifier(target)} = ${quoteIdentifier(source)}
     WHERE (${quoteIdentifier(target)} IS NULL OR ${quoteIdentifier(target)} = '')
       AND ${quoteIdentifier(source)} IS NOT NULL
       AND ${quoteIdentifier(source)} != ''
  `);
}

function getColumns(table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((item) => item.name);
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}
