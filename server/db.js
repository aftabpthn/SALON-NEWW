import Database from "better-sqlite3";
import { scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.AURA_DATA_DIR
  ? resolve(process.env.AURA_DATA_DIR)
  : join(__dirname, "..", "data");
mkdirSync(dataDir, { recursive: true });

export const dbPath = process.env.AURA_DB_PATH
  ? resolve(process.env.AURA_DB_PATH)
  : join(dataDir, process.env.AURA_DB_FILE || "salon-crm.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export const DEFAULT_TENANT_ID = "tenant_aura";

export const jsonColumns = {
  subscription_plans: ["limits", "features"],
  feature_toggles: ["rules"],
  super_admin_audit: ["details"],
  platform_analytics_snapshots: ["metrics", "insights"],
  tenant_users: ["branchIds"],
  auth_refresh_tokens: [],
  mobile_devices: ["capabilities"],
  push_subscriptions: ["metadata"],
  push_notifications: ["payload"],
  realtime_events: ["payload"],
  realtime_queue_items: ["payload", "history"],
  staff_presence: [],
  staff_attendance: [],
  staff_shifts: ["serviceIds"],
  staff_commission_runs: ["summary", "entries"],
  payroll_exports: ["rows", "totals"],
  suppliers: [],
  inventory_batches: [],
  inventory_predictions: ["metrics", "suggestions"],
  inventory_waste_events: [],
  ai_marketing_generations: ["input", "segment", "output", "actions"],
  ai_task_overrides: ["allowedRoles", "blockedRoles"],
  ai_policy_denials: ["details"],
  ai_response_cache: ["output", "usage"],
  ai_automation_rules: ["conditions", "actions"],
  ai_automation_runs: ["summary"],
  ai_automation_suggestions: ["payload"],
  migration_mappings: ["mapping", "unmatchedColumns", "requiredFields"],
  migration_jobs: ["mapping", "settings", "summary"],
  migration_import_batches: ["summary", "filters"],
  migration_row_results: ["payload", "raw", "errors", "warnings"],
  migration_audit_logs: ["details"],
  marketing_workflows: ["triggerRule", "steps", "metrics"],
  marketing_sequences: ["audienceRule", "steps", "metrics"],
  email_templates: ["variables"],
  booking_recommendations: ["request", "recommendations", "selectedSlot", "signals"],
  booking_waitlist: ["serviceIds", "preferences", "recommendations"],
  online_booking_requests: ["serviceIds", "clientInfo", "preferences", "recommendedSlots"],
  qr_checkins: ["metadata"],
  security_audit_logs: ["details"],
  security_activity_events: ["metadata"],
  security_sessions: ["metadata"],
  security_backups: ["manifest", "result"],
  security_permissions: ["actions", "conditions"],
  role_definitions: ["permissions"],
  encrypted_secrets: ["metadata"],
  quality_runs: ["result", "details"],
  deployment_events: ["result"],
  offline_sync_items: ["payload", "conflicts", "result"],
  offline_cache_snapshots: ["data", "metadata"],
  white_label_profiles: ["theme", "assets", "settings"],
  branch_branding: ["theme", "assets"],
  innovation_runs: ["input", "signals", "output", "actions"],
  voice_booking_sessions: ["transcript", "entities", "actions"],
  kiosk_sessions: ["state", "events"],

  voice_call_logs: ["transcript", "entities", "actions", "providerPayload"],
  queue_displays: ["layout", "filters", "theme"],
  dynamic_pricing_rules: ["conditions", "adjustments", "approval"],
  growth_advisor_tasks: ["signals", "recommendations", "outcomes"],
  franchises: ["territory", "complianceChecklist", "sharedTemplates"],
  franchise_royalties: ["calculation", "payments"],
  training_lessons: ["content", "attachments", "quiz"],
  training_assignments: ["progress", "quizResult", "certificate"],
  image_analyses: ["input", "findings", "recommendations", "consent"],
  reputation_reviews: ["metadata", "aiReply", "alerts"],
  marketplace_connections: ["credentials", "scopes", "health"],
  gamification_events: ["points", "badges", "metadata"],
  fraud_alerts: ["signals", "evidence", "resolution"],
  smart_forms: ["schema", "rules", "signatureConfig"],
  form_responses: ["answers", "signature", "metadata"],
  recommendation_events: ["input", "recommendations", "feedback"],
  warehouse_snapshots: ["dimensions", "facts", "aggregates"],
  kpi_monitors: ["target", "current", "alerts"],
  appointment_optimizations: ["input", "recommendations", "appliedChanges"],
  api_keys: ["scopes", "rateLimits", "metadata"],
  webhooks: ["events", "headers", "retryPolicy", "lastDelivery"],
  forecasting_models: ["features", "metrics", "predictions"],
  knowledge_base_articles: ["tags", "contentBlocks", "embeddingMetadata"],
  plugin_manifests: ["permissions", "extensionPoints", "settings"],
  app_marketplace_apps: ["features", "pricing", "installState"],
  localization_profiles: ["countries", "currencies", "taxRules", "translations"],
  workflow_definitions: ["trigger", "conditions", "actions"],
  workflow_runs: ["triggerSource", "audience", "actionResult"],
  finance_daily_closings: ["totals", "payments", "expenses", "refunds", "payouts"],
  coupon_codes: ["rules"],
  wallet_transactions: ["metadata"],
  credit_notes: ["lineItems"],
  invoice_documents: ["payload"],
  customer_intelligence_snapshots: ["metrics", "insights", "nextBestAction"],
  customer_timeline_events: ["metadata"],
  booking_portal_events: ["payload"],
  analytics_snapshots: ["input", "metrics", "insights"],
  ai_interactions: ["input", "context", "output", "actions"],
  ai_knowledge_documents: ["metadata"],
  ai_knowledge_query_logs: ["matches"],
  ai_whatsapp_drafts: ["detectedIntent", "suggestedAction", "auditTrail"],
  whatsapp_threads: ["tags", "metadata"],
  whatsapp_messages: ["metadata"],
  whatsapp_automation_rules: ["conditions", "actions"],
  whatsapp_handoffs: ["history"],
  clients: ["tags", "preferences", "allergies", "safetyFlags", "communicationPreferences", "visitHistory", "purchaseHistory", "whatsappHistory", "consentForms", "familyAccount", "formulas", "segments"],
  appointments: ["serviceIds"],
  services: ["assignedStaff", "requiredProducts", "addOns", "packageServices"],
  products: [],
  inventory_transactions: [],
  sales: ["items", "splitPayments", "membershipRedeem"],
  invoices: ["lineItems"],
  payments: [],
  memberships: ["serviceCredits", "redeemHistory"],
  packages: ["serviceIds", "packageCredits", "rules"],
  commissions: ["rule", "tiers", "metadata"],
  staff: ["assignedServices", "permissions", "commissionRule", "attendance", "performance"],
  branches: [],
  campaigns: ["segmentRule"],
  message_logs: ["payload", "providerResponse"],
  audit_logs: ["details"],
  notifications: [],
  settings: ["value"],
  gift_cards: ["redeemHistory"]
};

export const resources = {
  tenants: { table: "tenants", required: ["name", "slug"], tenantScoped: false },
  subscriptionPlans: { table: "subscription_plans", required: ["name", "code"], tenantScoped: false },
  featureToggles: { table: "feature_toggles", required: ["key", "name"], tenantScoped: false },
  platformAnalytics: { table: "platform_analytics_snapshots", required: ["type", "metrics"], tenantScoped: false },
  superAdminAudit: { table: "super_admin_audit", required: ["action"], tenantScoped: false },
  subscriptions: { table: "subscriptions", required: ["planId", "status"], tenantScoped: true },
  tenantUsers: { table: "tenant_users", required: ["name", "email", "role"], tenantScoped: true },
  domainMappings: { table: "domain_mappings", required: ["domain"], tenantScoped: true },
  usageEvents: { table: "usage_events", required: ["metric", "quantity"], tenantScoped: true },
  mobileDevices: { table: "mobile_devices", required: ["userId", "platform"], tenantScoped: true },
  pushSubscriptions: { table: "push_subscriptions", required: ["userId", "deviceId", "endpoint"], tenantScoped: true },
  pushNotifications: { table: "push_notifications", required: ["title", "message"], tenantScoped: true },
  realtimeEvents: { table: "realtime_events", required: ["channel", "type", "payload"], tenantScoped: true },
  realtimeQueue: { table: "realtime_queue_items", required: ["branchId", "type", "title"], tenantScoped: true },
  staffPresence: { table: "staff_presence", required: ["userId", "status"], tenantScoped: true },
  staffAttendance: { table: "staff_attendance", required: ["staffId", "date", "status"], tenantScoped: true },
  staffShifts: { table: "staff_shifts", required: ["staffId", "branchId", "date", "startTime", "endTime"], tenantScoped: true },
  staffCommissionRuns: { table: "staff_commission_runs", required: ["periodStart", "periodEnd", "entries"], tenantScoped: true },
  payrollExports: { table: "payroll_exports", required: ["periodStart", "periodEnd", "rows"], tenantScoped: true },
  suppliers: { table: "suppliers", required: ["name"], tenantScoped: true },
  inventoryBatches: { table: "inventory_batches", required: ["productId", "branchId", "batchNumber"], tenantScoped: true },
  inventoryPredictions: { table: "inventory_predictions", required: ["type", "metrics", "suggestions"], tenantScoped: true },
  inventoryWasteEvents: { table: "inventory_waste_events", required: ["productId", "branchId", "quantity", "reason"], tenantScoped: true },
  aiMarketingGenerations: { table: "ai_marketing_generations", required: ["type", "output"], tenantScoped: true },
  marketingWorkflows: { table: "marketing_workflows", required: ["name", "trigger"], tenantScoped: true },
  marketingSequences: { table: "marketing_sequences", required: ["name", "channel"], tenantScoped: true },
  emailTemplates: { table: "email_templates", required: ["name", "subject", "body"], tenantScoped: true },
  bookingRecommendations: { table: "booking_recommendations", required: ["request", "recommendations"], tenantScoped: true },
  bookingWaitlist: { table: "booking_waitlist", required: ["clientId", "branchId"], tenantScoped: true },
  onlineBookingRequests: { table: "online_booking_requests", required: ["branchId", "clientInfo"], tenantScoped: true },
  qrCheckins: { table: "qr_checkins", required: ["branchId", "source"], tenantScoped: true },
  securityAuditLogs: { table: "security_audit_logs", required: ["action"], tenantScoped: true },
  securityActivityEvents: { table: "security_activity_events", required: ["method", "path"], tenantScoped: true },
  securitySessions: { table: "security_sessions", required: ["userId"], tenantScoped: true },
  securityBackups: { table: "security_backups", required: ["type"], tenantScoped: true },
  securityPermissions: { table: "security_permissions", required: ["role", "resource"], tenantScoped: true },
  roleDefinitions: { table: "role_definitions", required: ["role", "name"], tenantScoped: true },
  encryptedSecrets: { table: "encrypted_secrets", required: ["name", "ciphertext"], tenantScoped: true },
  qualityRuns: { table: "quality_runs", required: ["type", "status"], tenantScoped: true },
  deploymentEvents: { table: "deployment_events", required: ["type", "status"], tenantScoped: true },
  offlineSyncItems: { table: "offline_sync_items", required: ["deviceId", "entity", "operation"], tenantScoped: true },
  offlineCacheSnapshots: { table: "offline_cache_snapshots", required: ["deviceId", "resource", "data"], tenantScoped: true },
  whiteLabelProfiles: { table: "white_label_profiles", required: ["name"], tenantScoped: true },
  branchBranding: { table: "branch_branding", required: ["branchId"], tenantScoped: true },
  innovationRuns: { table: "innovation_runs", required: ["type", "output"], tenantScoped: true },
  voiceBookingSessions: { table: "voice_booking_sessions", required: ["channel"], tenantScoped: true },
  kioskSessions: { table: "kiosk_sessions", required: ["branchId", "mode"], tenantScoped: true },

  voiceCallLogs: { table: "voice_call_logs", required: ["branchId", "phone", "intent"], tenantScoped: true },
  queueDisplays: { table: "queue_displays", required: ["branchId", "name"], tenantScoped: true },
  dynamicPricingRules: { table: "dynamic_pricing_rules", required: ["name", "scope"], tenantScoped: true },
  growthAdvisorTasks: { table: "growth_advisor_tasks", required: ["title", "priority"], tenantScoped: true },
  franchises: { table: "franchises", required: ["name", "ownerName"], tenantScoped: true },
  franchiseRoyalties: { table: "franchise_royalties", required: ["franchiseId", "periodStart", "periodEnd"], tenantScoped: true },
  trainingLessons: { table: "training_lessons", required: ["title", "category"], tenantScoped: true },
  trainingAssignments: { table: "training_assignments", required: ["lessonId", "staffId"], tenantScoped: true },
  imageAnalyses: { table: "image_analyses", required: ["clientId", "analysisType"], tenantScoped: true },
  reputationReviews: { table: "reputation_reviews", required: ["platform", "rating", "reviewer"], tenantScoped: true },
  marketplaceConnections: { table: "marketplace_connections", required: ["provider", "status"], tenantScoped: true },
  gamificationEvents: { table: "gamification_events", required: ["subjectType", "subjectId", "eventType"], tenantScoped: true },
  fraudAlerts: { table: "fraud_alerts", required: ["alertType", "severity"], tenantScoped: true },
  smartForms: { table: "smart_forms", required: ["name", "formType"], tenantScoped: true },
  formResponses: { table: "form_responses", required: ["formId", "clientId"], tenantScoped: true },
  recommendationEvents: { table: "recommendation_events", required: ["clientId", "type"], tenantScoped: true },
  warehouseSnapshots: { table: "warehouse_snapshots", required: ["snapshotType", "periodStart", "periodEnd"], tenantScoped: true },
  kpiMonitors: { table: "kpi_monitors", required: ["name", "metric"], tenantScoped: true },
  appointmentOptimizations: { table: "appointment_optimizations", required: ["branchId", "optimizationType"], tenantScoped: true },
  apiKeys: { table: "api_keys", required: ["name", "keyHash"], tenantScoped: true },
  webhooks: { table: "webhooks", required: ["name", "url"], tenantScoped: true },
  forecastingModels: { table: "forecasting_models", required: ["name", "modelType"], tenantScoped: true },
  knowledgeBaseArticles: { table: "knowledge_base_articles", required: ["title", "audience"], tenantScoped: true },
  pluginManifests: { table: "plugin_manifests", required: ["name", "version"], tenantScoped: true },
  appMarketplaceApps: { table: "app_marketplace_apps", required: ["name", "category"], tenantScoped: true },
  localizationProfiles: { table: "localization_profiles", required: ["name", "primaryCountry"], tenantScoped: true },
  workflowDefinitions: { table: "workflow_definitions", required: ["name"], tenantScoped: true },
  workflowRuns: { table: "workflow_runs", required: ["workflowId"], tenantScoped: true },
  financeCashDrawers: { table: "finance_cash_drawers", required: ["branchId"], tenantScoped: true },
  financeExpenses: { table: "finance_expenses", required: ["branchId", "category", "amount"], tenantScoped: true },
  financeDailyClosings: { table: "finance_daily_closings", required: ["branchId", "businessDate"], tenantScoped: true },
  financeRefunds: { table: "finance_refunds", required: ["invoiceId", "amount"], tenantScoped: true },
  financeStaffPayouts: { table: "finance_staff_payouts", required: ["staffId", "periodStart", "periodEnd"], tenantScoped: true },
  couponCodes: { table: "coupon_codes", required: ["code", "name", "type", "value"], tenantScoped: true },
  walletTransactions: { table: "wallet_transactions", required: ["clientId", "type", "amount"], tenantScoped: true },
  creditNotes: { table: "credit_notes", required: ["invoiceId", "amount"], tenantScoped: true },
  invoiceDocuments: { table: "invoice_documents", required: ["invoiceId", "format"], tenantScoped: true },
  customerIntelligenceSnapshots: { table: "customer_intelligence_snapshots", required: ["clientId", "metrics"], tenantScoped: true },
  customerTimelineEvents: { table: "customer_timeline_events", required: ["clientId", "type", "title"], tenantScoped: true },
  bookingPortalEvents: { table: "booking_portal_events", required: ["type"], tenantScoped: true },
  analyticsSnapshots: { table: "analytics_snapshots", required: ["type", "metrics"], tenantScoped: true },
  aiInteractions: { table: "ai_interactions", required: ["type", "prompt"], tenantScoped: true },
  aiKnowledgeDocuments: { table: "ai_knowledge_documents", required: ["title", "content"], tenantScoped: true },
  aiKnowledgeChunks: { table: "ai_knowledge_chunks", required: ["documentId", "content"], tenantScoped: true },
  aiKnowledgeQueryLogs: { table: "ai_knowledge_query_logs", required: ["query"], tenantScoped: true },
  aiWhatsappDrafts: { table: "ai_whatsapp_drafts", required: ["message"], tenantScoped: true },
  whatsappThreads: { table: "whatsapp_threads", required: ["phone"], tenantScoped: true },
  whatsappMessages: { table: "whatsapp_messages", required: ["threadId", "direction", "body"], tenantScoped: true },
  whatsappRules: { table: "whatsapp_automation_rules", required: ["name", "trigger", "template"], tenantScoped: true },
  whatsappHandoffs: { table: "whatsapp_handoffs", required: ["threadId", "reason"], tenantScoped: true },
  clients: { table: "clients", required: ["name", "phone"] },
  appointments: { table: "appointments", required: ["clientId", "staffId", "branchId", "startAt"] },
  services: { table: "services", required: ["name", "category", "price", "durationMinutes"] },
  products: { table: "products", required: ["name", "sku", "branchId"] },
  inventory: { table: "inventory_transactions", required: ["productId", "branchId", "type", "quantity"] },
  sales: { table: "sales", required: ["clientId", "branchId", "items"] },
  invoices: { table: "invoices", required: ["saleId", "clientId", "invoiceNumber"] },
  payments: { table: "payments", required: ["invoiceId", "mode", "amount"] },
  memberships: { table: "memberships", required: ["planName", "clientId"] },
  packages: { table: "packages", required: ["name", "price", "serviceIds"] },
  commissions: { table: "commissions", required: ["name", "staffId", "type"] },
  staff: { table: "staff", required: ["name", "role", "branchId"] },
  marketing: { table: "campaigns", required: ["name", "channel"] },
  messageLogs: { table: "message_logs", required: ["channel", "recipient", "message"] },
  auditLogs: { table: "audit_logs", required: ["action"] },
  branches: { table: "branches", required: ["name", "city"] },
  settings: { table: "settings", required: ["key", "value"] },
  notifications: { table: "notifications", required: ["channel", "message"] },
  giftCards: { table: "gift_cards", required: ["code", "initialValue"] }
};

const schema = [
  `CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    priceMonthly REAL DEFAULT 0,
    trialDays INTEGER DEFAULT 14,
    limits TEXT DEFAULT '{}',
    features TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feature_toggles (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    scope TEXT DEFAULT 'global',
    tenantId TEXT DEFAULT '',
    planId TEXT DEFAULT NULL,
    enabled INTEGER DEFAULT 0,
    rules TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS super_admin_audit (
    id TEXT PRIMARY KEY,
    actorUserId TEXT DEFAULT '',
    action TEXT NOT NULL,
    targetType TEXT DEFAULT '',
    targetId TEXT DEFAULT '',
    details TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_analytics_snapshots (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    periodStart TEXT DEFAULT '',
    periodEnd TEXT DEFAULT '',
    metrics TEXT DEFAULT '{}',
    insights TEXT DEFAULT '[]',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'trialing',
    planId TEXT DEFAULT NULL,
    subscriptionStatus TEXT DEFAULT 'trialing',
    trialEndsAt TEXT DEFAULT '',
    ownerEmail TEXT DEFAULT '',
    primaryDomain TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(planId) REFERENCES subscription_plans(id)
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    planId TEXT NOT NULL,
    status TEXT DEFAULT 'trialing',
    trialStart TEXT DEFAULT '',
    trialEndsAt TEXT DEFAULT '',
    currentPeriodStart TEXT DEFAULT '',
    currentPeriodEnd TEXT DEFAULT '',
    cancelAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(planId) REFERENCES subscription_plans(id)
  )`,
  `CREATE TABLE IF NOT EXISTS tenant_users (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    loginId TEXT DEFAULT '',
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    branchIds TEXT DEFAULT '[]',
    staffId TEXT DEFAULT '',
    passwordSalt TEXT DEFAULT '',
    passwordHash TEXT DEFAULT '',
    failedLoginCount INTEGER DEFAULT 0,
    lockedUntil TEXT DEFAULT '',
    lastLoginAt TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS domain_mappings (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'pending',
    isPrimary INTEGER DEFAULT 0,
    verifiedAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    metric TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    periodStart TEXT DEFAULT '',
    periodEnd TEXT DEFAULT '',
    referenceType TEXT DEFAULT '',
    referenceId TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    userId TEXT NOT NULL,
    tokenHash TEXT NOT NULL UNIQUE,
    deviceId TEXT DEFAULT '',
    role TEXT DEFAULT '',
    branchId TEXT DEFAULT '',
    expiresAt TEXT NOT NULL,
    revokedAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mobile_devices (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    userId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    platform TEXT NOT NULL,
    deviceToken TEXT DEFAULT '',
    pushProvider TEXT DEFAULT 'fcm',
    appVersion TEXT DEFAULT '',
    capabilities TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    lastSeenAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    userId TEXT NOT NULL,
    deviceId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    endpoint TEXT NOT NULL,
    platform TEXT DEFAULT '',
    provider TEXT DEFAULT 'fcm',
    authSecret TEXT DEFAULT '',
    p256dh TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS push_notifications (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    userId TEXT DEFAULT '',
    branchId TEXT DEFAULT '',
    deviceId TEXT DEFAULT '',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'queued',
    providerMessageId TEXT DEFAULT '',
    sentAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS realtime_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    channel TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS realtime_queue_items (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    appointmentId TEXT DEFAULT '',
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'waiting',
    assignedStaffId TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    history TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS staff_presence (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    userId TEXT NOT NULL,
    staffId TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    deviceId TEXT DEFAULT '',
    lastSeenAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS staff_attendance (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    staffId TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT DEFAULT 'present',
    clockIn TEXT DEFAULT '',
    clockOut TEXT DEFAULT '',
    minutesWorked REAL DEFAULT 0,
    overtimeMinutes REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(staffId) REFERENCES staff(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS staff_shifts (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    staffId TEXT NOT NULL,
    date TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    role TEXT DEFAULT '',
    chair TEXT DEFAULT '',
    serviceIds TEXT DEFAULT '[]',
    status TEXT DEFAULT 'planned',
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(staffId) REFERENCES staff(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS staff_commission_runs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    periodStart TEXT NOT NULL,
    periodEnd TEXT NOT NULL,
    summary TEXT DEFAULT '{}',
    entries TEXT DEFAULT '[]',
    status TEXT DEFAULT 'calculated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS payroll_exports (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    periodStart TEXT NOT NULL,
    periodEnd TEXT NOT NULL,
    format TEXT DEFAULT 'csv',
    rows TEXT DEFAULT '[]',
    totals TEXT DEFAULT '{}',
    status TEXT DEFAULT 'ready',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    contactName TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    address TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_batches (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    productId TEXT NOT NULL,
    supplierId TEXT DEFAULT '',
    batchNumber TEXT NOT NULL,
    expiryDate TEXT DEFAULT '',
    quantityReceived REAL DEFAULT 0,
    quantityAvailable REAL DEFAULT 0,
    unitCost REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id),
    FOREIGN KEY(productId) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_predictions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    periodStart TEXT DEFAULT '',
    periodEnd TEXT DEFAULT '',
    metrics TEXT DEFAULT '{}',
    suggestions TEXT DEFAULT '[]',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_waste_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    productId TEXT NOT NULL,
    batchId TEXT DEFAULT '',
    quantity REAL DEFAULT 0,
    reason TEXT NOT NULL,
    costImpact REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id),
    FOREIGN KEY(productId) REFERENCES products(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_marketing_generations (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    campaignId TEXT DEFAULT '',
    input TEXT DEFAULT '{}',
    segment TEXT DEFAULT '{}',
    output TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS marketing_workflows (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    channel TEXT DEFAULT 'WhatsApp',
    status TEXT DEFAULT 'draft',
    triggerRule TEXT DEFAULT '{}',
    steps TEXT DEFAULT '[]',
    metrics TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS marketing_sequences (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    channel TEXT NOT NULL,
    campaignId TEXT DEFAULT '',
    audienceRule TEXT DEFAULT '{}',
    steps TEXT DEFAULT '[]',
    status TEXT DEFAULT 'draft',
    metrics TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    purpose TEXT DEFAULT '',
    variables TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS booking_recommendations (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    source TEXT DEFAULT 'smart-booking',
    request TEXT DEFAULT '{}',
    recommendations TEXT DEFAULT '[]',
    selectedSlot TEXT DEFAULT '{}',
    signals TEXT DEFAULT '{}',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS booking_waitlist (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId TEXT NOT NULL,
    serviceIds TEXT DEFAULT '[]',
    preferredDate TEXT DEFAULT '',
    preferredStaffId TEXT DEFAULT '',
    preferences TEXT DEFAULT '{}',
    recommendations TEXT DEFAULT '[]',
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'waiting',
    convertedAppointmentId TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS online_booking_requests (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    clientInfo TEXT DEFAULT '{}',
    serviceIds TEXT DEFAULT '[]',
    preferences TEXT DEFAULT '{}',
    recommendedSlots TEXT DEFAULT '[]',
    selectedSlotAt TEXT DEFAULT '',
    status TEXT DEFAULT 'requested',
    source TEXT DEFAULT 'online-portal',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS qr_checkins (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    appointmentId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    source TEXT NOT NULL,
    code TEXT DEFAULT '',
    queueItemId TEXT DEFAULT '',
    status TEXT DEFAULT 'arrived',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS security_audit_logs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    actorUserId TEXT DEFAULT '',
    actorRole TEXT DEFAULT '',
    action TEXT NOT NULL,
    targetType TEXT DEFAULT '',
    targetId TEXT DEFAULT '',
    severity TEXT DEFAULT 'info',
    ipAddress TEXT DEFAULT '',
    userAgent TEXT DEFAULT '',
    details TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS security_activity_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    userId TEXT DEFAULT '',
    role TEXT DEFAULT '',
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    statusCode INTEGER DEFAULT 0,
    durationMs INTEGER DEFAULT 0,
    ipAddress TEXT DEFAULT '',
    userAgent TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS security_sessions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    userId TEXT NOT NULL,
    role TEXT DEFAULT '',
    branchId TEXT DEFAULT '',
    deviceId TEXT DEFAULT '',
    ipAddress TEXT DEFAULT '',
    userAgent TEXT DEFAULT '',
    startedAt TEXT DEFAULT '',
    lastSeenAt TEXT DEFAULT '',
    expiresAt TEXT DEFAULT '',
    revokedAt TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS security_backups (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    filePath TEXT DEFAULT '',
    fileSizeBytes INTEGER DEFAULT 0,
    checksum TEXT DEFAULT '',
    manifest TEXT DEFAULT '{}',
    result TEXT DEFAULT '{}',
    status TEXT DEFAULT 'completed',
    createdBy TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS security_permissions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    role TEXT NOT NULL,
    resource TEXT NOT NULL,
    actions TEXT DEFAULT '[]',
    effect TEXT DEFAULT 'allow',
    conditions TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS role_definitions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    permissions TEXT DEFAULT '[]',
    isSystem INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    createdBy TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS encrypted_secrets (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    purpose TEXT DEFAULT '',
    algorithm TEXT DEFAULT 'aes-256-gcm',
    iv TEXT DEFAULT '',
    authTag TEXT DEFAULT '',
    ciphertext TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS quality_runs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    result TEXT DEFAULT '{}',
    details TEXT DEFAULT '[]',
    startedAt TEXT DEFAULT '',
    completedAt TEXT DEFAULT '',
    createdBy TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS deployment_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    environment TEXT DEFAULT 'production',
    version TEXT DEFAULT '',
    status TEXT NOT NULL,
    result TEXT DEFAULT '{}',
    createdBy TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS offline_sync_items (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    deviceId TEXT NOT NULL,
    entity TEXT NOT NULL,
    operation TEXT NOT NULL,
    localId TEXT DEFAULT '',
    serverId TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    conflicts TEXT DEFAULT '[]',
    result TEXT DEFAULT '{}',
    status TEXT DEFAULT 'queued',
    attemptedAt TEXT DEFAULT '',
    syncedAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS offline_cache_snapshots (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    deviceId TEXT NOT NULL,
    resource TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    metadata TEXT DEFAULT '{}',
    version INTEGER DEFAULT 1,
    status TEXT DEFAULT 'fresh',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS white_label_profiles (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    brandName TEXT DEFAULT '',
    logoUrl TEXT DEFAULT '',
    faviconUrl TEXT DEFAULT '',
    domain TEXT DEFAULT '',
    theme TEXT DEFAULT '{}',
    assets TEXT DEFAULT '{}',
    settings TEXT DEFAULT '{}',
    isDefault INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS branch_branding (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    profileId TEXT DEFAULT '',
    brandName TEXT DEFAULT '',
    logoUrl TEXT DEFAULT '',
    theme TEXT DEFAULT '{}',
    assets TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS innovation_runs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    input TEXT DEFAULT '{}',
    signals TEXT DEFAULT '{}',
    output TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    confidence REAL DEFAULT 0,
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS voice_booking_sessions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    channel TEXT NOT NULL,
    transcript TEXT DEFAULT '[]',
    entities TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS kiosk_sessions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    mode TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    state TEXT DEFAULT '{}',
    events TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,

  `CREATE TABLE IF NOT EXISTS voice_call_logs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    phone TEXT NOT NULL,
    language TEXT DEFAULT 'en-IN',
    intent TEXT NOT NULL,
    transcript TEXT DEFAULT '[]',
    entities TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    providerPayload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'open',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS queue_displays (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    displayCode TEXT DEFAULT '',
    layout TEXT DEFAULT '{}',
    filters TEXT DEFAULT '{}',
    theme TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS dynamic_pricing_rules (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    scope TEXT NOT NULL,
    conditions TEXT DEFAULT '{}',
    adjustments TEXT DEFAULT '{}',
    approval TEXT DEFAULT '{}',
    status TEXT DEFAULT 'draft',
    startsAt TEXT DEFAULT '',
    endsAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS growth_advisor_tasks (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    title TEXT NOT NULL,
    priority TEXT NOT NULL,
    ownerUserId TEXT DEFAULT '',
    dueDate TEXT DEFAULT '',
    signals TEXT DEFAULT '{}',
    recommendations TEXT DEFAULT '[]',
    outcomes TEXT DEFAULT '{}',
    status TEXT DEFAULT 'open',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS franchises (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    ownerName TEXT NOT NULL,
    ownerEmail TEXT DEFAULT '',
    territory TEXT DEFAULT '{}',
    status TEXT DEFAULT 'onboarding',
    royaltyPercent REAL DEFAULT 0,
    complianceScore REAL DEFAULT 0,
    complianceChecklist TEXT DEFAULT '[]',
    sharedTemplates TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS franchise_royalties (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    franchiseId TEXT NOT NULL,
    periodStart TEXT NOT NULL,
    periodEnd TEXT NOT NULL,
    grossRevenue REAL DEFAULT 0,
    royaltyAmount REAL DEFAULT 0,
    calculation TEXT DEFAULT '{}',
    payments TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(franchiseId) REFERENCES franchises(id)
  )`,
  `CREATE TABLE IF NOT EXISTS training_lessons (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    level TEXT DEFAULT 'beginner',
    durationMinutes INTEGER DEFAULT 0,
    content TEXT DEFAULT '{}',
    attachments TEXT DEFAULT '[]',
    quiz TEXT DEFAULT '{}',
    status TEXT DEFAULT 'published',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS training_assignments (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    lessonId TEXT NOT NULL,
    staffId TEXT NOT NULL,
    dueDate TEXT DEFAULT '',
    progress TEXT DEFAULT '{}',
    quizResult TEXT DEFAULT '{}',
    certificate TEXT DEFAULT '{}',
    status TEXT DEFAULT 'assigned',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(lessonId) REFERENCES training_lessons(id),
    FOREIGN KEY(staffId) REFERENCES staff(id)
  )`,
  `CREATE TABLE IF NOT EXISTS image_analyses (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT NOT NULL,
    analysisType TEXT NOT NULL,
    imageUri TEXT DEFAULT '',
    input TEXT DEFAULT '{}',
    findings TEXT DEFAULT '{}',
    recommendations TEXT DEFAULT '[]',
    consent TEXT DEFAULT '{}',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS reputation_reviews (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    platform TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    rating REAL NOT NULL,
    reviewText TEXT DEFAULT '',
    sentiment TEXT DEFAULT 'neutral',
    metadata TEXT DEFAULT '{}',
    aiReply TEXT DEFAULT '{}',
    alerts TEXT DEFAULT '[]',
    status TEXT DEFAULT 'new',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS marketplace_connections (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    provider TEXT NOT NULL,
    accountName TEXT DEFAULT '',
    credentials TEXT DEFAULT '{}',
    scopes TEXT DEFAULT '[]',
    health TEXT DEFAULT '{}',
    status TEXT NOT NULL,
    lastSyncAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS gamification_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    subjectType TEXT NOT NULL,
    subjectId TEXT NOT NULL,
    eventType TEXT NOT NULL,
    points TEXT DEFAULT '{}',
    badges TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS fraud_alerts (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    alertType TEXT NOT NULL,
    severity TEXT NOT NULL,
    subjectType TEXT DEFAULT '',
    subjectId TEXT DEFAULT '',
    riskScore REAL DEFAULT 0,
    signals TEXT DEFAULT '{}',
    evidence TEXT DEFAULT '[]',
    resolution TEXT DEFAULT '{}',
    status TEXT DEFAULT 'open',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS smart_forms (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    formType TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    schema TEXT DEFAULT '{}',
    rules TEXT DEFAULT '{}',
    signatureConfig TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS form_responses (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    formId TEXT NOT NULL,
    clientId TEXT NOT NULL,
    appointmentId TEXT DEFAULT '',
    answers TEXT DEFAULT '{}',
    signature TEXT DEFAULT '{}',
    metadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'submitted',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(formId) REFERENCES smart_forms(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS recommendation_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT NOT NULL,
    type TEXT NOT NULL,
    input TEXT DEFAULT '{}',
    recommendations TEXT DEFAULT '[]',
    feedback TEXT DEFAULT '{}',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS warehouse_snapshots (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    snapshotType TEXT NOT NULL,
    periodStart TEXT NOT NULL,
    periodEnd TEXT NOT NULL,
    dimensions TEXT DEFAULT '{}',
    facts TEXT DEFAULT '{}',
    aggregates TEXT DEFAULT '{}',
    status TEXT DEFAULT 'materialized',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS kpi_monitors (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    metric TEXT NOT NULL,
    target TEXT DEFAULT '{}',
    current TEXT DEFAULT '{}',
    alerts TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS appointment_optimizations (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    optimizationType TEXT NOT NULL,
    input TEXT DEFAULT '{}',
    recommendations TEXT DEFAULT '[]',
    appliedChanges TEXT DEFAULT '[]',
    score REAL DEFAULT 0,
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    keyPrefix TEXT DEFAULT '',
    keyHash TEXT NOT NULL,
    scopes TEXT DEFAULT '[]',
    rateLimits TEXT DEFAULT '{}',
    metadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    lastUsedAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT DEFAULT '[]',
    headers TEXT DEFAULT '{}',
    retryPolicy TEXT DEFAULT '{}',
    lastDelivery TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS forecasting_models (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    modelType TEXT NOT NULL,
    horizonDays INTEGER DEFAULT 30,
    features TEXT DEFAULT '{}',
    metrics TEXT DEFAULT '{}',
    predictions TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_base_articles (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    title TEXT NOT NULL,
    audience TEXT NOT NULL,
    category TEXT DEFAULT '',
    body TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    contentBlocks TEXT DEFAULT '[]',
    embeddingMetadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'published',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_manifests (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    vendor TEXT DEFAULT '',
    permissions TEXT DEFAULT '[]',
    extensionPoints TEXT DEFAULT '[]',
    settings TEXT DEFAULT '{}',
    status TEXT DEFAULT 'installed',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS app_marketplace_apps (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    provider TEXT DEFAULT '',
    features TEXT DEFAULT '[]',
    pricing TEXT DEFAULT '{}',
    installState TEXT DEFAULT '{}',
    status TEXT DEFAULT 'available',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS localization_profiles (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    primaryCountry TEXT NOT NULL,
    countries TEXT DEFAULT '[]',
    currencies TEXT DEFAULT '[]',
    taxRules TEXT DEFAULT '{}',
    translations TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_definitions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    trigger TEXT DEFAULT '{}',
    conditions TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    delayMinutes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    lastRunAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    workflowId TEXT NOT NULL,
    triggerSource TEXT DEFAULT '{}',
    audience TEXT DEFAULT '[]',
    actionResult TEXT DEFAULT '{}',
    status TEXT DEFAULT 'completed',
    startedAt TEXT DEFAULT '',
    completedAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(workflowId) REFERENCES workflow_definitions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_cash_drawers (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    openedBy TEXT DEFAULT '',
    closedBy TEXT DEFAULT '',
    openingFloat REAL DEFAULT 0,
    expectedCash REAL DEFAULT 0,
    countedCash REAL DEFAULT 0,
    variance REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    openedAt TEXT DEFAULT '',
    closedAt TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_expenses (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    category TEXT NOT NULL,
    vendor TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    taxAmount REAL DEFAULT 0,
    paymentMode TEXT DEFAULT 'cash',
    paidAt TEXT DEFAULT '',
    staffId TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'paid',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_daily_closings (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    businessDate TEXT NOT NULL,
    cashDrawerId TEXT DEFAULT '',
    totals TEXT DEFAULT '{}',
    payments TEXT DEFAULT '{}',
    expenses TEXT DEFAULT '[]',
    refunds TEXT DEFAULT '[]',
    payouts TEXT DEFAULT '[]',
    variance REAL DEFAULT 0,
    status TEXT DEFAULT 'closed',
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_refunds (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    invoiceId TEXT NOT NULL,
    saleId TEXT DEFAULT '',
    paymentId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    mode TEXT DEFAULT 'original',
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'processed',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(invoiceId) REFERENCES invoices(id)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_staff_payouts (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    staffId TEXT NOT NULL,
    periodStart TEXT NOT NULL,
    periodEnd TEXT NOT NULL,
    commissionAmount REAL DEFAULT 0,
    incentiveAmount REAL DEFAULT 0,
    deductions REAL DEFAULT 0,
    netAmount REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    paidAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(staffId) REFERENCES staff(id)
  )`,
  `CREATE TABLE IF NOT EXISTS coupon_codes (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value REAL DEFAULT 0,
    maxDiscount REAL DEFAULT 0,
    minSubtotal REAL DEFAULT 0,
    startsAt TEXT DEFAULT '',
    endsAt TEXT DEFAULT '',
    usageLimit INTEGER DEFAULT 0,
    usedCount INTEGER DEFAULT 0,
    rules TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balanceAfter REAL DEFAULT 0,
    referenceType TEXT DEFAULT '',
    referenceId TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS credit_notes (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    invoiceId TEXT NOT NULL,
    saleId TEXT DEFAULT '',
    clientId TEXT NOT NULL,
    creditNoteNumber TEXT NOT NULL,
    amount REAL NOT NULL,
    reason TEXT DEFAULT '',
    lineItems TEXT DEFAULT '[]',
    status TEXT DEFAULT 'issued',
    createdBy TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(invoiceId) REFERENCES invoices(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_documents (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    invoiceId TEXT NOT NULL,
    invoiceNumber TEXT NOT NULL,
    format TEXT DEFAULT 'html',
    content TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(invoiceId) REFERENCES invoices(id)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_intelligence_snapshots (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT NOT NULL,
    metrics TEXT DEFAULT '{}',
    insights TEXT DEFAULT '[]',
    nextBestAction TEXT DEFAULT '{}',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_timeline_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS booking_portal_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    appointmentId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    sessionId TEXT DEFAULT '',
    type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'completed',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_interactions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    appointmentId TEXT DEFAULT '',
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    input TEXT DEFAULT '{}',
    context TEXT DEFAULT '{}',
    output TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    model TEXT DEFAULT 'local-business-rules',
    status TEXT DEFAULT 'completed',
    confidence REAL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    title TEXT NOT NULL,
    category TEXT DEFAULT 'policy',
    content TEXT NOT NULL,
    sourceType TEXT DEFAULT 'manual',
    sourceKey TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    documentId TEXT NOT NULL,
    chunkIndex INTEGER DEFAULT 0,
    title TEXT DEFAULT '',
    content TEXT NOT NULL,
    tokenCount INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(documentId) REFERENCES ai_knowledge_documents(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_query_logs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    query TEXT NOT NULL,
    matches TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_whatsapp_drafts (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    threadId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    message TEXT DEFAULT '',
    detectedIntent TEXT DEFAULT '{}',
    confidence REAL DEFAULT 0,
    suggestedReply TEXT DEFAULT '',
    suggestedAction TEXT DEFAULT '{}',
    status TEXT DEFAULT 'draft',
    approvedAt TEXT DEFAULT '',
    handoffAt TEXT DEFAULT '',
    auditTrail TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_tenant_settings (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL UNIQUE,
    dailyCallLimit INTEGER DEFAULT 10000,
    dailyCostLimitUsd REAL DEFAULT 5,
    providerMode TEXT DEFAULT 'local',
    fallbackMode TEXT DEFAULT 'local-business-rules',
    enabled INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_task_overrides (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    taskKey TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    allowedRoles TEXT DEFAULT '[]',
    blockedRoles TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    UNIQUE(tenantId, taskKey)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_policy_denials (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    taskKey TEXT NOT NULL,
    role TEXT DEFAULT '',
    reason TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_response_cache (
    cache_key TEXT PRIMARY KEY,
    task_key TEXT NOT NULL,
    tenantId TEXT NOT NULL,
    output TEXT DEFAULT '{}',
    usage TEXT DEFAULT '{}',
    model TEXT DEFAULT 'local-business-rules',
    provider TEXT DEFAULT 'local',
    prompt_version TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    hit_count INTEGER DEFAULT 0,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_cost_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    task_key TEXT NOT NULL,
    provider TEXT DEFAULT 'local',
    model TEXT DEFAULT 'local-business-rules',
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    cached INTEGER DEFAULT 0,
    latency_ms REAL DEFAULT 0,
    request_id TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_automation_rules (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    conditions TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    lastRunAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_automation_runs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    ruleId TEXT DEFAULT '',
    type TEXT NOT NULL,
    status TEXT DEFAULT 'completed',
    summary TEXT DEFAULT '{}',
    suggestionsCreated INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_automation_suggestions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    ruleId TEXT DEFAULT '',
    runId TEXT DEFAULT '',
    type TEXT NOT NULL,
    targetType TEXT DEFAULT '',
    targetId TEXT DEFAULT '',
    title TEXT NOT NULL,
    message TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'draft',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    type TEXT NOT NULL,
    periodStart TEXT DEFAULT '',
    periodEnd TEXT DEFAULT '',
    input TEXT DEFAULT '{}',
    metrics TEXT DEFAULT '{}',
    insights TEXT DEFAULT '[]',
    status TEXT DEFAULT 'generated',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_threads (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    phone TEXT NOT NULL,
    displayName TEXT DEFAULT '',
    source TEXT DEFAULT 'inbound',
    status TEXT DEFAULT 'open',
    intent TEXT DEFAULT 'unknown',
    leadScore REAL DEFAULT 0,
    assignedUserId TEXT DEFAULT '',
    handoffStatus TEXT DEFAULT 'none',
    lastMessageAt TEXT DEFAULT '',
    lastMessagePreview TEXT DEFAULT '',
    unreadCount INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    threadId TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    branchId TEXT DEFAULT '',
    direction TEXT NOT NULL,
    eventType TEXT DEFAULT '',
    body TEXT NOT NULL,
    templateKey TEXT DEFAULT '',
    intent TEXT DEFAULT '',
    status TEXT DEFAULT 'queued',
    providerMessageId TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(threadId) REFERENCES whatsapp_threads(id)
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_automation_rules (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    template TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    delayMinutes INTEGER DEFAULT 0,
    conditions TEXT DEFAULT '{}',
    actions TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_handoffs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    threadId TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    branchId TEXT DEFAULT '',
    reason TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    assignedTo TEXT DEFAULT '',
    history TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(threadId) REFERENCES whatsapp_threads(id)
  )`,
  `CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    timezone TEXT DEFAULT 'Asia/Kolkata',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    gender TEXT DEFAULT '',
    birthday TEXT DEFAULT '',
    anniversary TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    walletBalance REAL DEFAULT 0,
    loyaltyPoints INTEGER DEFAULT 0,
    membershipId TEXT DEFAULT '',
    branchId TEXT,
    totalSpend REAL DEFAULT 0,
    visitCount INTEGER DEFAULT 0,
    lastVisitAt TEXT DEFAULT '',
    visitHistory TEXT DEFAULT '[]',
    purchaseHistory TEXT DEFAULT '[]',
    whatsappHistory TEXT DEFAULT '[]',
    consentForms TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    branchId TEXT NOT NULL,
    shift TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    assignedServices TEXT DEFAULT '[]',
    commissionRule TEXT DEFAULT '{}',
    attendance TEXT DEFAULT '[]',
    performance TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    durationMinutes INTEGER NOT NULL,
    assignedStaff TEXT DEFAULT '[]',
    requiredProducts TEXT DEFAULT '[]',
    addOns TEXT DEFAULT '[]',
    packageServices TEXT DEFAULT '[]',
    gstRate REAL DEFAULT 18,
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    category TEXT DEFAULT '',
    usageType TEXT DEFAULT 'retail',
    supplier TEXT DEFAULT '',
    branchId TEXT NOT NULL,
    stock REAL DEFAULT 0,
    lowStockThreshold REAL DEFAULT 5,
    expiryDate TEXT DEFAULT '',
    unitCost REAL DEFAULT 0,
    price REAL DEFAULT 0,
    gstRate REAL DEFAULT 18,
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    staffId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    serviceIds TEXT DEFAULT '[]',
    startAt TEXT NOT NULL,
    endAt TEXT DEFAULT '',
    status TEXT DEFAULT 'booked',
    source TEXT DEFAULT 'front-desk',
    onlineStatus TEXT DEFAULT 'not-online',
    chair TEXT DEFAULT '',
    room TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    billable INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(clientId) REFERENCES clients(id),
    FOREIGN KEY(staffId) REFERENCES staff(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_transactions (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    batchId TEXT DEFAULT '',
    supplierId TEXT DEFAULT '',
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    unitCost REAL DEFAULT 0,
    totalCost REAL DEFAULT 0,
    reason TEXT DEFAULT '',
    referenceType TEXT DEFAULT '',
    referenceId TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(productId) REFERENCES products(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    appointmentId TEXT DEFAULT '',
    branchId TEXT NOT NULL,
    staffId TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    subtotal REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    gstAmount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    commissionTotal REAL DEFAULT 0,
    membershipRedeem TEXT DEFAULT '{}',
    splitPayments TEXT DEFAULT '[]',
    status TEXT DEFAULT 'completed',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(clientId) REFERENCES clients(id),
    FOREIGN KEY(branchId) REFERENCES branches(id)
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    saleId TEXT NOT NULL,
    clientId TEXT NOT NULL,
    invoiceNumber TEXT NOT NULL UNIQUE,
    lineItems TEXT DEFAULT '[]',
    subtotal REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    gstAmount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'unpaid',
    dueDate TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(saleId) REFERENCES sales(id),
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    invoiceId TEXT NOT NULL,
    mode TEXT NOT NULL,
    amount REAL NOT NULL,
    reference TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY(invoiceId) REFERENCES invoices(id)
  )`,
  `CREATE TABLE IF NOT EXISTS day_close_locks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    business_date TEXT NOT NULL,
    status TEXT DEFAULT 'locked',
    locked_by TEXT DEFAULT '',
    locked_at TEXT DEFAULT '',
    reopened_by TEXT DEFAULT '',
    reopened_at TEXT DEFAULT '',
    reopen_reason TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, branch_id, business_date)
  )`,
  `CREATE TABLE IF NOT EXISTS z_reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    business_date TEXT NOT NULL,
    report_no TEXT NOT NULL,
    sales_total REAL DEFAULT 0,
    refund_total REAL DEFAULT 0,
    net_sales REAL DEFAULT 0,
    tax_total REAL DEFAULT 0,
    discount_total REAL DEFAULT 0,
    cash_total REAL DEFAULT 0,
    upi_total REAL DEFAULT 0,
    card_total REAL DEFAULT 0,
    wallet_total REAL DEFAULT 0,
    razorpay_total REAL DEFAULT 0,
    tips_total REAL DEFAULT 0,
    invoice_count INTEGER DEFAULT 0,
    void_count INTEGER DEFAULT 0,
    refund_count INTEGER DEFAULT 0,
    opening_cash REAL DEFAULT 0,
    closing_cash REAL DEFAULT 0,
    cash_difference REAL DEFAULT 0,
    generated_by TEXT DEFAULT '',
    generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    report_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (tenant_id, branch_id, business_date, report_no)
  )`,
  `CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    terminal_id TEXT DEFAULT '',
    opening_cash REAL DEFAULT 0,
    closing_cash REAL DEFAULT 0,
    expected_cash REAL DEFAULT 0,
    cash_difference REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    planName TEXT NOT NULL,
    price REAL DEFAULT 0,
    planCredits INTEGER DEFAULT 0,
    creditsRemaining INTEGER DEFAULT 0,
    serviceCredits TEXT DEFAULT '[]',
    validityDate TEXT DEFAULT '',
    autoRenew INTEGER DEFAULT 0,
    loyaltyMultiplier REAL DEFAULT 1,
    status TEXT DEFAULT 'active',
    redeemHistory TEXT DEFAULT '[]',
    branchId TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(clientId) REFERENCES clients(id)
  )`,
  `CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL DEFAULT 0,
    validityDays INTEGER DEFAULT 0,
    serviceIds TEXT DEFAULT '[]',
    packageCredits TEXT DEFAULT '[]',
    rules TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS commissions (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    staffId TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value REAL DEFAULT 0,
    rule TEXT DEFAULT '{}',
    tiers TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id),
    FOREIGN KEY(staffId) REFERENCES staff(id)
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    tenantId TEXT DEFAULT '${DEFAULT_TENANT_ID}',
    branchId TEXT DEFAULT '',
    name TEXT NOT NULL,
    channel TEXT NOT NULL,
    segmentRule TEXT DEFAULT '{}',
    template TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    scheduledAt TEXT DEFAULT '',
    sentCount INTEGER DEFAULT 0,
    conversionValue REAL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS message_logs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    campaignId TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    message TEXT NOT NULL,
    direction TEXT DEFAULT 'outbound',
    status TEXT DEFAULT 'queued',
    providerMessageId TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    providerResponse TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    branchId TEXT DEFAULT '',
    actorUserId TEXT DEFAULT '',
    action TEXT NOT NULL,
    entityType TEXT DEFAULT '',
    entityId TEXT DEFAULT '',
    severity TEXT DEFAULT 'info',
    details TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    clientId TEXT DEFAULT '',
    type TEXT DEFAULT '',
    channel TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT DEFAULT '{}',
    scope TEXT DEFAULT 'global',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS migration_mappings (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    sourceSoftware TEXT DEFAULT '',
    resource TEXT NOT NULL,
    name TEXT NOT NULL,
    mapping TEXT DEFAULT '{}',
    unmatchedColumns TEXT DEFAULT '[]',
    requiredFields TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS migration_jobs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    sourceSoftware TEXT DEFAULT '',
    adapter TEXT DEFAULT '',
    resource TEXT DEFAULT 'auto',
    fileName TEXT DEFAULT '',
    status TEXT DEFAULT 'ready',
    dryRun INTEGER DEFAULT 0,
    migrationMode INTEGER DEFAULT 1,
    mapping TEXT DEFAULT '{}',
    settings TEXT DEFAULT '{}',
    totalRows INTEGER DEFAULT 0,
    importedRows INTEGER DEFAULT 0,
    skippedRows INTEGER DEFAULT 0,
    warningRows INTEGER DEFAULT 0,
    errorRows INTEGER DEFAULT 0,
    summary TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS migration_import_batches (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    jobId TEXT DEFAULT '',
    sourceSoftware TEXT DEFAULT '',
    resource TEXT DEFAULT 'auto',
    branchId TEXT DEFAULT '',
    status TEXT DEFAULT 'importing',
    summary TEXT DEFAULT '{}',
    filters TEXT DEFAULT '{}',
    rolledBackAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS migration_row_results (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    jobId TEXT DEFAULT '',
    batchId TEXT DEFAULT '',
    resource TEXT DEFAULT '',
    entity TEXT DEFAULT '',
    sourceSheet TEXT DEFAULT '',
    sourceRowNumber INTEGER DEFAULT 0,
    sourceExternalId TEXT DEFAULT '',
    action TEXT DEFAULT '',
    targetId TEXT DEFAULT '',
    status TEXT DEFAULT '',
    message TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    raw TEXT DEFAULT '{}',
    errors TEXT DEFAULT '[]',
    warnings TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS migration_audit_logs (
    id TEXT PRIMARY KEY,
    tenantId TEXT NOT NULL,
    jobId TEXT DEFAULT '',
    batchId TEXT DEFAULT '',
    action TEXT NOT NULL,
    actorUserId TEXT DEFAULT '',
    details TEXT DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(tenantId) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS gift_cards (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    clientId TEXT DEFAULT '',
    initialValue REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    expiryDate TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    redeemHistory TEXT DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS print_devices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    terminal_id TEXT DEFAULT '',
    device_name TEXT NOT NULL,
    device_type TEXT DEFAULT 'thermal',
    connection_type TEXT DEFAULT 'browser',
    config_json TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    terminal_id TEXT DEFAULT '',
    invoice_id TEXT DEFAULT '',
    device_id TEXT DEFAULT '',
    format TEXT DEFAULT 'thermal',
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'queued',
    attempts INTEGER DEFAULT 0,
    last_error TEXT DEFAULT '',
    printed_at TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS barcode_scan_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT DEFAULT '',
    terminal_id TEXT DEFAULT '',
    scanned_code TEXT DEFAULT '',
    code TEXT DEFAULT '',
    scan_type TEXT DEFAULT 'lookup',
    matched_product_id TEXT DEFAULT '',
    result_json TEXT DEFAULT '{}',
    resolved_entity_type TEXT DEFAULT '',
    resolved_entity_id TEXT DEFAULT '',
    status TEXT DEFAULT 'unresolved',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT DEFAULT '',
    company_name TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    billing_email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    credit_limit REAL DEFAULT 0,
    current_outstanding REAL DEFAULT 0,
    payment_terms_days INTEGER DEFAULT 30,
    status TEXT DEFAULT 'active',
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS corporate_account_members (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    corporate_account_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    employee_code TEXT DEFAULT '',
    department TEXT DEFAULT '',
    spending_limit REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor_user_id TEXT DEFAULT '',
    source TEXT DEFAULT '',
    payload_json TEXT DEFAULT '{}',
    hash TEXT DEFAULT '',
    previous_hash TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS discount_approval_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    approved_by TEXT DEFAULT '',
    discount_type TEXT NOT NULL,
    discount_value REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    decision_note TEXT DEFAULT '',
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS coupon_usage (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    coupon_code TEXT NOT NULL,
    customer_id TEXT DEFAULT '',
    invoice_id TEXT DEFAULT '',
    discount_amount REAL DEFAULT 0,
    used_at TEXT DEFAULT CURRENT_TIMESTAMP,
    branch_id TEXT DEFAULT '',
    staff_id TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS coupon_abuse_alerts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT DEFAULT '',
    coupon_code TEXT DEFAULT '',
    alert_type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'open',
    resolved_by TEXT DEFAULT '',
    resolved_at TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    gift_card_id TEXT NOT NULL,
    invoice_id TEXT DEFAULT '',
    type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    balance_after REAL NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS store_credits (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    source_invoice_id TEXT DEFAULT '',
    source_refund_id TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    expiry_date TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS store_credit_transactions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    store_credit_id TEXT NOT NULL,
    invoice_id TEXT DEFAULT '',
    type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    balance_after REAL NOT NULL DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS offline_sync_queue (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    terminal_id TEXT DEFAULT '',
    device_id TEXT DEFAULT '',
    entity_type TEXT NOT NULL,
    entity_id TEXT DEFAULT '',
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    local_created_at TEXT DEFAULT '',
    sync_status TEXT DEFAULT 'pending',
    conflict_status TEXT DEFAULT 'none',
    server_version INTEGER DEFAULT 0,
    client_version INTEGER DEFAULT 0,
    error_message TEXT DEFAULT '',
    synced_at TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`
];

schema.forEach((statement) => db.prepare(statement).run());

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const isJsonColumn = (table, key) => (jsonColumns[table] || []).includes(key);

function stringifyBindable(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify(String(value));
  }
}

function bindableValue(table, key, value) {
  if (isJsonColumn(table, key)) return stringifyBindable(value);
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  const valueType = typeof value;
  if (["number", "string", "bigint"].includes(valueType)) return value;
  if (valueType === "boolean") return value ? 1 : 0;
  if (valueType === "object") return stringifyBindable(value);
  return String(value);
}
export const tenantScopedTables = [
  "branches",
  "clients",
  "staff",
  "services",
  "products",
  "appointments",
  "inventory_transactions",
  "sales",
  "invoices",
  "payments",
  "memberships",
  "packages",
  "commissions",
  "campaigns",
  "message_logs",
  "audit_logs",
  "notifications",
  "settings",
  "migration_mappings",
  "migration_jobs",
  "migration_import_batches",
  "migration_row_results",
  "migration_audit_logs",
  "gift_cards",
  "subscriptions",
  "tenant_users",
  "domain_mappings",
  "usage_events",
  "auth_refresh_tokens",
  "mobile_devices",
  "push_subscriptions",
  "push_notifications",
  "realtime_events",
  "realtime_queue_items",
  "staff_presence",
  "staff_attendance",
  "staff_shifts",
  "staff_commission_runs",
  "payroll_exports",
  "suppliers",
  "inventory_batches",
  "inventory_predictions",
  "inventory_waste_events",
  "ai_marketing_generations",
  "marketing_workflows",
  "marketing_sequences",
  "email_templates",
  "booking_recommendations",
  "booking_waitlist",
  "online_booking_requests",
  "qr_checkins",
  "security_audit_logs",
  "security_activity_events",
  "security_sessions",
  "security_backups",
  "security_permissions",
  "role_definitions",
  "encrypted_secrets",
  "quality_runs",
  "deployment_events",
  "offline_sync_items",
  "offline_cache_snapshots",
  "white_label_profiles",
  "branch_branding",
  "innovation_runs",
  "voice_booking_sessions",
  "kiosk_sessions",

  "voice_call_logs",
  "queue_displays",
  "dynamic_pricing_rules",
  "growth_advisor_tasks",
  "franchises",
  "franchise_royalties",
  "training_lessons",
  "training_assignments",
  "image_analyses",
  "reputation_reviews",
  "marketplace_connections",
  "gamification_events",
  "fraud_alerts",
  "smart_forms",
  "form_responses",
  "recommendation_events",
  "warehouse_snapshots",
  "kpi_monitors",
  "appointment_optimizations",
  "api_keys",
  "webhooks",
  "forecasting_models",
  "knowledge_base_articles",
  "plugin_manifests",
  "app_marketplace_apps",
  "localization_profiles",
  "workflow_definitions",
  "workflow_runs",
  "finance_cash_drawers",
  "finance_expenses",
  "finance_daily_closings",
  "finance_refunds",
  "finance_staff_payouts",
  "coupon_codes",
  "wallet_transactions",
  "credit_notes",
  "invoice_documents",
  "customer_intelligence_snapshots",
  "customer_timeline_events",
  "booking_portal_events",
  "analytics_snapshots",
  "ai_interactions",
  "ai_knowledge_documents",
  "ai_knowledge_chunks",
  "ai_knowledge_query_logs",
  "ai_whatsapp_drafts",
  "ai_tenant_settings",
  "ai_task_overrides",
  "ai_policy_denials",
  "ai_response_cache",
  "ai_cost_ledger",
  "ai_automation_rules",
  "ai_automation_runs",
  "ai_automation_suggestions",
  "whatsapp_threads",
  "whatsapp_messages",
  "whatsapp_automation_rules",
  "whatsapp_handoffs",
  "print_devices",
  "print_jobs",
  "barcode_scan_events",
  "corporate_accounts",
  "corporate_account_members",
  "invoice_events",
  "discount_approval_requests",
  "coupon_usage",
  "coupon_abuse_alerts",
  "gift_card_transactions",
  "store_credits",
  "store_credit_transactions",
  "offline_sync_queue"
];
export const columnsFor = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
export const tableHasColumn = (table, column) => columnsFor(table).includes(column);

function ensureColumn(table, column, definition) {
  if (!tableHasColumn(table, column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function migrateTenantColumns() {
  for (const table of tenantScopedTables) {
    ensureColumn(table, "tenantId", `TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
    db.prepare(`UPDATE ${table} SET tenantId = ? WHERE tenantId IS NULL OR tenantId = ''`).run(DEFAULT_TENANT_ID);
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenantId)`).run();
  }
}

migrateTenantColumns();

function migrateBranchColumns() {
  for (const table of tenantScopedTables) {
    ensureColumn(table, "branchId", "TEXT DEFAULT ''");
  }
}

migrateBranchColumns();

function migrateTenantSettingsKey() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get();
  if (!row?.sql?.includes("key TEXT NOT NULL UNIQUE")) return;
  db.prepare("DROP TABLE IF EXISTS settings_next").run();
  db.prepare(`CREATE TABLE settings_next (
    id TEXT PRIMARY KEY,
    tenantId TEXT DEFAULT '${DEFAULT_TENANT_ID}',
    key TEXT NOT NULL,
    value TEXT DEFAULT '{}',
    scope TEXT DEFAULT 'global',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`).run();
  db.prepare(`INSERT INTO settings_next (id, tenantId, key, value, scope, createdAt, updatedAt)
    SELECT id, COALESCE(NULLIF(tenantId, ''), '${DEFAULT_TENANT_ID}'), key, value, scope, createdAt, updatedAt FROM settings`).run();
  db.prepare("DROP TABLE settings").run();
  db.prepare("ALTER TABLE settings_next RENAME TO settings").run();
}

migrateTenantSettingsKey();
db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_key ON settings(tenantId, key)").run();

function migrateOperationalColumns() {
  ensureColumn("tenant_users", "loginId", "TEXT DEFAULT ''");
  ensureColumn("tenant_users", "staffId", "TEXT DEFAULT ''");
  ensureColumn("tenant_users", "passwordSalt", "TEXT DEFAULT ''");
  ensureColumn("tenant_users", "passwordHash", "TEXT DEFAULT ''");
  ensureColumn("tenant_users", "failedLoginCount", "INTEGER DEFAULT 0");
  ensureColumn("tenant_users", "lockedUntil", "TEXT DEFAULT ''");
  ensureColumn("tenant_users", "lastLoginAt", "TEXT DEFAULT ''");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON tenant_users(tenantId, email)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_tenant_users_login_id ON tenant_users(tenantId, loginId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_tenant_users_staff ON tenant_users(tenantId, staffId)").run();
  ensureColumn("inventory_transactions", "batchId", "TEXT DEFAULT ''");
  ensureColumn("inventory_transactions", "supplierId", "TEXT DEFAULT ''");
  ensureColumn("inventory_transactions", "unitCost", "REAL DEFAULT 0");
  ensureColumn("inventory_transactions", "totalCost", "REAL DEFAULT 0");
  ensureColumn("sales", "couponCode", "TEXT DEFAULT ''");
  ensureColumn("sales", "couponDiscount", "REAL DEFAULT 0");
  ensureColumn("clients", "preferences", "TEXT DEFAULT '{}'");
  ensureColumn("clients", "allergies", "TEXT DEFAULT '[]'");
  ensureColumn("clients", "safetyFlags", "TEXT DEFAULT '{}'");
  ensureColumn("clients", "communicationPreferences", "TEXT DEFAULT '{}'");
  ensureColumn("clients", "imported", "INTEGER DEFAULT 0");
  ensureColumn("clients", "originalSystem", "TEXT DEFAULT ''");
  ensureColumn("clients", "originalRecordId", "TEXT DEFAULT ''");
  ensureColumn("clients", "importedAt", "TEXT DEFAULT ''");
  ensureColumn("clients", "importBatchId", "TEXT DEFAULT ''");
  ensureColumn("staff", "permissions", "TEXT DEFAULT '[]'");
  ensureColumn("invoices", "tenant_id", `TEXT DEFAULT '${DEFAULT_TENANT_ID}'`);
  ensureColumn("invoices", "branch_id", "TEXT DEFAULT ''");
  ensureColumn("invoices", "customer_id", "TEXT DEFAULT ''");
  ensureColumn("invoices", "invoice_no", "TEXT DEFAULT ''");
  ensureColumn("invoices", "payment_status", "TEXT DEFAULT ''");
  ensureColumn("invoices", "paid_amount", "REAL DEFAULT 0");
  ensureColumn("invoices", "due_amount", "REAL DEFAULT 0");
  ensureColumn("invoices", "discount_total", "REAL DEFAULT 0");
  ensureColumn("invoices", "grand_total", "REAL DEFAULT 0");
  ensureColumn("invoices", "created_at", "TEXT DEFAULT ''");
  ensureColumn("invoices", "updated_at", "TEXT DEFAULT ''");
  ensureColumn("invoices", "branchId", "TEXT DEFAULT ''");
  ensureColumn("invoices", "staffId", "TEXT DEFAULT ''");
  ensureColumn("invoices", "couponCode", "TEXT DEFAULT ''");
  ensureColumn("invoices", "couponDiscount", "REAL DEFAULT 0");
  db.prepare(`
    UPDATE invoices
    SET tenant_id = tenantId
    WHERE tenantId IS NOT NULL
      AND (tenant_id IS NULL OR tenant_id = '')
  `).run();
  db.prepare(`
    UPDATE invoices
    SET branchId = (
      SELECT sales.branchId FROM sales WHERE sales.id = invoices.saleId
    )
    WHERE (branchId IS NULL OR branchId = '')
      AND saleId IN (SELECT id FROM sales)
  `).run();
  db.prepare(`
    UPDATE invoices
    SET branch_id = branchId
    WHERE branchId IS NOT NULL
      AND (branch_id IS NULL OR branch_id = '')
  `).run();
  db.prepare(`
    UPDATE invoices
    SET staffId = (
      SELECT sales.staffId FROM sales WHERE sales.id = invoices.saleId
    )
    WHERE (staffId IS NULL OR staffId = '')
      AND saleId IN (SELECT id FROM sales)
  `).run();
  db.prepare("UPDATE invoices SET customer_id = clientId WHERE (customer_id IS NULL OR customer_id = '') AND clientId IS NOT NULL").run();
  db.prepare("UPDATE invoices SET invoice_no = invoiceNumber WHERE (invoice_no IS NULL OR invoice_no = '') AND invoiceNumber IS NOT NULL").run();
  db.prepare("UPDATE invoices SET payment_status = status WHERE (payment_status IS NULL OR payment_status = '') AND status IS NOT NULL").run();
  db.prepare("UPDATE invoices SET paid_amount = paid WHERE (paid_amount IS NULL OR paid_amount = 0) AND paid IS NOT NULL").run();
  db.prepare("UPDATE invoices SET due_amount = balance WHERE (due_amount IS NULL OR due_amount = 0) AND balance IS NOT NULL").run();
  db.prepare("UPDATE invoices SET discount_total = discount WHERE (discount_total IS NULL OR discount_total = 0) AND discount IS NOT NULL").run();
  db.prepare("UPDATE invoices SET grand_total = total WHERE (grand_total IS NULL OR grand_total = 0) AND total IS NOT NULL").run();
  db.prepare("UPDATE invoices SET created_at = createdAt WHERE (created_at IS NULL OR created_at = '') AND createdAt IS NOT NULL").run();
  db.prepare("UPDATE invoices SET updated_at = updatedAt WHERE (updated_at IS NULL OR updated_at = '') AND updatedAt IS NOT NULL").run();
  ensureColumn("packages", "branchId", "TEXT DEFAULT ''");
  ensureColumn("packages", "packageCredits", "TEXT DEFAULT '[]'");
  ensureColumn("packages", "rules", "TEXT DEFAULT '{}'");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_date ON staff_attendance(tenantId, staffId, date)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_staff_shifts_branch_date ON staff_shifts(tenantId, branchId, date)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_appointments_branch_start ON appointments(tenantId, branchId, startAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_day_close_locks_tenant_branch ON day_close_locks(tenant_id, branch_id, business_date)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_tenant_branch_status ON cash_drawer_sessions(tenant_id, branch_id, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_z_reports_tenant_branch_date ON z_reports(tenant_id, branch_id, business_date)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_migration_jobs_tenant_created ON migration_jobs(tenantId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_migration_batches_tenant_status ON migration_import_batches(tenantId, status, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_migration_rows_job ON migration_row_results(tenantId, jobId, sourceSheet, sourceRowNumber)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_batches_product ON inventory_batches(tenantId, productId, branchId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product ON inventory_transactions(tenantId, productId, branchId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_auth_refresh_user ON auth_refresh_tokens(tenantId, userId, expiresAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_mobile_devices_user ON mobile_devices(tenantId, userId, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_push_notifications_user ON push_notifications(tenantId, userId, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_realtime_events_channel ON realtime_events(tenantId, channel, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_realtime_queue_branch ON realtime_queue_items(tenantId, branchId, status, priority)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_presence_user ON staff_presence(tenantId, userId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_feature_toggles_scope ON feature_toggles(scope, tenantId, planId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_marketing_generations_type ON ai_marketing_generations(tenantId, type, createdAt)").run();
  ensureColumn("ai_knowledge_documents", "sourceKey", "TEXT DEFAULT ''");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_scope ON ai_knowledge_documents(tenantId, branchId, status, sourceType)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_documents_source ON ai_knowledge_documents(tenantId, branchId, sourceType, sourceKey) WHERE sourceKey <> ''").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_scope ON ai_knowledge_chunks(tenantId, branchId, documentId, updatedAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_knowledge_query_logs_scope ON ai_knowledge_query_logs(tenantId, branchId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_whatsapp_drafts_scope ON ai_whatsapp_drafts(tenantId, branchId, status, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_cost_ledger_task ON ai_cost_ledger(tenantId, task_key, created_at)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_response_cache_tenant_task ON ai_response_cache(tenantId, task_key, expires_at)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_policy_denials_tenant ON ai_policy_denials(tenantId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_automation_rules_scope ON ai_automation_rules(tenantId, branchId, type, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_automation_runs_scope ON ai_automation_runs(tenantId, branchId, type, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_automation_suggestions_scope ON ai_automation_suggestions(tenantId, branchId, status, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_marketing_workflows_trigger ON marketing_workflows(tenantId, trigger, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_marketing_sequences_channel ON marketing_sequences(tenantId, channel, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_booking_recommendations_client ON booking_recommendations(tenantId, branchId, clientId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_booking_waitlist_status ON booking_waitlist(tenantId, branchId, status, preferredDate)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_online_booking_status ON online_booking_requests(tenantId, branchId, status, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_qr_checkins_appointment ON qr_checkins(tenantId, branchId, appointmentId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit_logs(tenantId, action, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_security_activity_path ON security_activity_events(tenantId, path, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_security_sessions_user ON security_sessions(tenantId, userId, status)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_security_permissions_role_resource ON security_permissions(tenantId, role, resource)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_role_definitions_role ON role_definitions(tenantId, role)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_quality_runs_type ON quality_runs(tenantId, type, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_deployment_events_type ON deployment_events(tenantId, type, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_offline_sync_status ON offline_sync_items(tenantId, deviceId, status, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_white_label_domain ON white_label_profiles(tenantId, domain, status)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_branding_branch ON branch_branding(tenantId, branchId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_innovation_runs_type ON innovation_runs(tenantId, type, createdAt)").run();

  db.prepare("CREATE INDEX IF NOT EXISTS idx_voice_call_logs_intent ON voice_call_logs(tenantId, branchId, intent, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_dynamic_pricing_scope ON dynamic_pricing_rules(tenantId, scope, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_franchise_royalties_period ON franchise_royalties(tenantId, franchiseId, periodStart, periodEnd)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_training_assignments_staff ON training_assignments(tenantId, staffId, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_reputation_reviews_rating ON reputation_reviews(tenantId, platform, rating, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status ON fraud_alerts(tenantId, severity, status, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_recommendation_events_client ON recommendation_events(tenantId, clientId, type, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_kpi_monitors_metric ON kpi_monitors(tenantId, metric, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(tenantId, keyPrefix, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_webhooks_status ON webhooks(tenantId, status, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_plugin_manifests_name ON plugin_manifests(tenantId, name, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_workflow_definitions_status ON workflow_definitions(tenantId, status, branchId)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(tenantId, workflowId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_drawers_branch ON finance_cash_drawers(tenantId, branchId, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_expenses_date ON finance_expenses(tenantId, branchId, paidAt)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_closing_day ON finance_daily_closings(tenantId, branchId, businessDate)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_refunds_invoice ON finance_refunds(tenantId, invoiceId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_payout_staff ON finance_staff_payouts(tenantId, staffId, periodStart, periodEnd)").run();
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_codes_code ON coupon_codes(tenantId, code)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_wallet_transactions_client ON wallet_transactions(tenantId, clientId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(tenantId, invoiceId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice ON invoice_documents(tenantId, invoiceId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_packages_branch_status ON packages(tenantId, branchId, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_commissions_staff ON commissions(tenantId, staffId, status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_message_logs_recipient ON message_logs(tenantId, channel, recipient, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(tenantId, action, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_customer_intelligence_client ON customer_intelligence_snapshots(tenantId, clientId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_customer_timeline_client ON customer_timeline_events(tenantId, clientId, createdAt)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_booking_portal_events_appointment ON booking_portal_events(tenantId, appointmentId, createdAt)").run();
}

migrateOperationalColumns();

export function serialize(table, data) {
  const output = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    output[key] = bindableValue(table, key, value);
  }
  return output;
}

export function deserialize(table, row) {
  if (!row) return row;
  const output = { ...row };
  for (const key of jsonColumns[table] || []) {
    try {
      output[key] = output[key] ? JSON.parse(output[key]) : null;
    } catch {
      output[key] = null;
    }
  }
  return output;
}

export function listRows(table, {
  q = "",
  branchId = "",
  tenantId = "",
  limit = 250,
  from = "",
  to = "",
  startAtFrom = "",
  startAtTo = ""
} = {}) {
  const columns = columnsFor(table);
  const where = [];
  const params = {};
  if (q) {
    where.push(`(${columns.map((column) => `${column} LIKE @q`).join(" OR ")})`);
    params.q = `%${q}%`;
  }
  if (branchId && columns.includes("branchId")) {
    where.push("branchId = @branchId");
    params.branchId = branchId;
  }
  if (tenantId && columns.includes("tenantId")) {
    where.push("tenantId = @tenantId");
    params.tenantId = tenantId;
  }
  const fromBoundary = normalizeDateBoundary(startAtFrom || from, "from");
  const toBoundary = normalizeDateBoundary(startAtTo || to, "to");
  if (columns.includes("startAt") && fromBoundary) {
    where.push("startAt >= @startAtFrom");
    params.startAtFrom = fromBoundary;
  }
  if (columns.includes("startAt") && toBoundary) {
    where.push("startAt < @startAtTo");
    params.startAtTo = toBoundary;
  }
  params.limit = Number(limit) || 250;
  const orderBy = columns.includes("startAt") && (fromBoundary || toBoundary)
    ? "startAt ASC"
    : columns.includes("createdAt")
      ? "createdAt DESC"
      : "id ASC";
  const sql = `SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy} LIMIT @limit`;
  return db.prepare(sql).all(params).map((row) => deserialize(table, row));
}

function normalizeDateBoundary(value, side) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    if (side === "to") {
      const date = new Date(`${text}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString();
    }
    return `${text}T00:00:00.000Z`;
  }
  return text;
}

export function getRow(table, rowId, { tenantId = "" } = {}) {
  const columns = columnsFor(table);
  if (tenantId && columns.includes("tenantId")) {
    return deserialize(table, db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenantId = ?`).get(rowId, tenantId));
  }
  return deserialize(table, db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId));
}

export function insertRow(table, data) {
  const columns = columnsFor(table);
  const base = {
    id: data.id || id(table.slice(0, 4)),
    ...data
  };
  if (columns.includes("tenantId")) base.tenantId = data.tenantId || DEFAULT_TENANT_ID;
  if (columns.includes("createdAt")) base.createdAt = data.createdAt || now();
  if (columns.includes("updatedAt")) base.updatedAt = data.updatedAt || now();
  const stamped = Object.fromEntries(
    Object.entries(serialize(table, base)).filter(([key]) => columns.includes(key))
  );
  const keys = Object.keys(stamped);
  const placeholders = keys.map((key) => `@${key}`).join(", ");
  db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`).run(stamped);
  return getRow(table, stamped.id);
}

export function updateRow(table, rowId, data, { tenantId = "" } = {}) {
  const columns = columnsFor(table);
  const base = { ...data };
  if (columns.includes("updatedAt")) base.updatedAt = now();
  const stamped = Object.fromEntries(
    Object.entries(serialize(table, base)).filter(([key]) => columns.includes(key))
  );
  const keys = Object.keys(stamped).filter((key) => key !== "id" && key !== "createdAt");
  if (!keys.length) return getRow(table, rowId);
  const setSql = keys.map((key) => `${key} = @${key}`).join(", ");
  const tenantSql = tenantId && columns.includes("tenantId") ? " AND tenantId = @tenantId" : "";
  db.prepare(`UPDATE ${table} SET ${setSql} WHERE id = @id${tenantSql}`).run({ ...stamped, id: rowId, tenantId });
  return getRow(table, rowId, { tenantId });
}

export function deleteRow(table, rowId, { tenantId = "" } = {}) {
  const existing = getRow(table, rowId, { tenantId });
  if (!existing) return false;
  const columns = columnsFor(table);
  if (tenantId && columns.includes("tenantId")) {
    db.prepare(`DELETE FROM ${table} WHERE id = ? AND tenantId = ?`).run(rowId, tenantId);
  } else {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(rowId);
  }
  return true;
}

function seedIfEmpty(table, rows) {
  const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  if (count > 0) return;
  rows.forEach((row) => insertRow(table, row));
}

function seedIfMissing(table, idValue, row) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(idValue);
  if (existing) return;
  if (table === "security_permissions") {
    const permission = db.prepare("SELECT id FROM security_permissions WHERE tenantId = ? AND role = ? AND resource = ?").get(row.tenantId || DEFAULT_TENANT_ID, row.role, row.resource);
    if (permission) return;
  }
  if (table === "role_definitions") {
    const definition = db.prepare("SELECT id FROM role_definitions WHERE tenantId = ? AND role = ?").get(row.tenantId || DEFAULT_TENANT_ID, row.role);
    if (definition) return;
  }
  try {
    insertRow(table, row);
  } catch (error) {
    if (!String(error?.code || "").includes("SQLITE_CONSTRAINT")) throw error;
  }
}

export function applyInventoryDelta({
  productId,
  branchId,
  batchId = "",
  supplierId = "",
  quantity,
  type,
  reason,
  referenceType,
  referenceId,
  unitCost = 0,
  totalCost = 0,
  tenantId = ""
}) {
  const product = getRow("products", productId, { tenantId });
  if (!product) throw Object.assign(new Error("Product not found"), { status: 404 });
  const nextStock = Number(product.stock) + Number(quantity);
  if (nextStock < 0) throw Object.assign(new Error(`${product.name} stock cannot go below zero`), { status: 409 });
  let resolvedBatchId = batchId;
  let resolvedSupplierId = supplierId;
  let resolvedUnitCost = Number(unitCost || 0);
  let resolvedTotalCost = Number(totalCost || 0);
  if (Number(quantity) < 0 && !resolvedBatchId) {
    const batch = db.prepare(`
      SELECT * FROM inventory_batches
      WHERE tenantId = ? AND productId = ? AND branchId = ? AND quantityAvailable > 0
      ORDER BY CASE WHEN expiryDate = '' THEN 1 ELSE 0 END, expiryDate ASC, createdAt ASC
      LIMIT 1
    `).get(tenantId || product.tenantId || DEFAULT_TENANT_ID, productId, branchId || product.branchId);
    if (batch) {
      resolvedBatchId = batch.id;
      resolvedSupplierId = resolvedSupplierId || batch.supplierId || "";
      resolvedUnitCost = resolvedUnitCost || Number(batch.unitCost || 0);
      resolvedTotalCost = resolvedTotalCost || Math.abs(Number(quantity)) * resolvedUnitCost;
      const available = Number(batch.quantityAvailable || 0);
      const nextAvailable = Math.max(0, available - Math.abs(Number(quantity)));
      db.prepare("UPDATE inventory_batches SET quantityAvailable = ?, status = ?, updatedAt = ? WHERE id = ? AND tenantId = ?").run(
        nextAvailable,
        nextAvailable <= 0 ? "depleted" : batch.status || "active",
        now(),
        batch.id,
        tenantId || product.tenantId || DEFAULT_TENANT_ID
      );
    }
  }
  updateRow("products", productId, { stock: nextStock }, { tenantId: tenantId || product.tenantId });
  return insertRow("inventory_transactions", {
    productId,
    branchId: branchId || product.branchId,
    batchId: resolvedBatchId,
    supplierId: resolvedSupplierId,
    type,
    quantity,
    unitCost: resolvedUnitCost,
    totalCost: resolvedTotalCost || Number(quantity) * resolvedUnitCost,
    reason,
    referenceType,
    referenceId,
    tenantId: tenantId || product.tenantId,
    createdAt: now()
  });
}

export function deductServiceUsage(serviceIds, branchId, referenceType, referenceId, tenantId = "") {
  const deductions = [];
  for (const serviceId of serviceIds || []) {
    const service = getRow("services", serviceId, { tenantId });
    for (const usage of service?.requiredProducts || []) {
      deductions.push(
        applyInventoryDelta({
          productId: usage.productId,
          branchId,
          quantity: -Math.abs(Number(usage.quantity || 0)),
          type: "service-deduction",
          reason: `${service.name} professional usage`,
          referenceType,
          referenceId,
          tenantId
        })
      );
    }
  }
  return deductions;
}

export function updateInvoiceStatus(invoiceId, tenantId = "") {
  const invoice = getRow("invoices", invoiceId, { tenantId });
  if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
  const paid = tenantId
    ? db.prepare("SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoiceId = ? AND tenantId = ?").get(invoiceId, tenantId).paid
    : db.prepare("SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoiceId = ?").get(invoiceId).paid;
  const balance = Math.max(0, Number(invoice.total) - Number(paid));
  const status = balance <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
  return updateRow("invoices", invoiceId, { paid, balance, status }, { tenantId });
}


function passwordHashFor(password, salt) {
  return scryptSync(String(password || ""), salt, 64).toString("hex");
}

function seedPasswordFields(password, salt = "aura-seed-admin-salt") {
  return {
    passwordSalt: salt,
    passwordHash: passwordHashFor(password, salt),
    failedLoginCount: 0,
    lockedUntil: "",
    lastLoginAt: ""
  };
}

function ensureTenantUserPassword(userId, password, salt) {
  const user = db.prepare("SELECT id, passwordHash FROM tenant_users WHERE id = ?").get(userId);
  if (!user || user.passwordHash) return;
  const fields = seedPasswordFields(password, salt);
  db.prepare(`UPDATE tenant_users
    SET passwordSalt = @passwordSalt, passwordHash = @passwordHash, failedLoginCount = 0, lockedUntil = '', updatedAt = @updatedAt
    WHERE id = @userId`).run({ ...fields, userId, updatedAt: now() });
}

export function seedDatabase() {
  const stamp = now();
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  seedIfEmpty("subscription_plans", [
    {
      id: "plan_starter",
      name: "Starter",
      code: "starter",
      priceMonthly: 2999,
      trialDays: 14,
      limits: { branches: 1, staff: 8, clients: 1000, monthlyAppointments: 1500, campaigns: 10 },
      features: ["Client CRM", "POS", "GST billing", "WhatsApp reminders"],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "plan_growth",
      name: "Growth",
      code: "growth",
      priceMonthly: 7999,
      trialDays: 14,
      limits: { branches: 5, staff: 40, clients: 10000, monthlyAppointments: 15000, campaigns: 100 },
      features: ["Multi-branch", "Advanced reports", "Memberships", "Marketing automation"],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "plan_enterprise",
      name: "Enterprise",
      code: "enterprise",
      priceMonthly: 24999,
      trialDays: 30,
      limits: { branches: 50, staff: 500, clients: 250000, monthlyAppointments: 500000, campaigns: 1000 },
      features: ["Custom domains", "Branch RBAC", "Enterprise reports", "Priority support"],
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("feature_toggles", [
    {
      id: "ft_ai_marketing",
      key: "ai.marketing",
      name: "AI marketing automation",
      description: "Enable AI campaign generation, offer recommendations and retargeting workflows.",
      scope: "global",
      enabled: 1,
      rules: { plans: ["growth", "enterprise"], rollout: 100 },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "ft_super_analytics",
      key: "platform.analytics",
      name: "Global SaaS analytics",
      description: "Expose platform revenue, tenant health and cross-salon analytics.",
      scope: "global",
      enabled: 1,
      rules: { roles: ["superAdmin"] },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "ft_realtime",
      key: "realtime.operations",
      name: "Realtime operations",
      description: "Live booking, queue, staff presence and dashboard events.",
      scope: "global",
      enabled: 1,
      rules: { plans: ["starter", "growth", "enterprise"] },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "ft_smart_booking",
      key: "smart.booking",
      name: "Smart booking engine",
      description: "Enable intelligent slot recommendations, waitlists, online booking and QR check-in.",
      scope: "global",
      enabled: 1,
      rules: { plans: ["growth", "enterprise"], rollout: 100 },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "ft_white_label",
      key: "white.label",
      name: "White-label SaaS",
      description: "Enable custom branding, themes, custom domains and branch-specific identity.",
      scope: "global",
      enabled: 1,
      rules: { plans: ["enterprise"], rollout: 100 },
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("tenants", [
    {
      id: DEFAULT_TENANT_ID,
      name: "Aura Salon Group",
      slug: "aura",
      status: "trialing",
      planId: "plan_growth",
      subscriptionStatus: "trialing",
      trialEndsAt,
      ownerEmail: "owner@aurasalon.example",
      primaryDomain: "aura.localhost",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("security_permissions", [
    {
      id: "perm_owner_all",
      tenantId: DEFAULT_TENANT_ID,
      role: "owner",
      resource: "*",
      actions: ["read", "write", "admin"],
      effect: "allow",
      conditions: { branchScoped: false },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "perm_frontdesk_booking",
      tenantId: DEFAULT_TENANT_ID,
      role: "frontDesk",
      resource: "smart-booking",
      actions: ["read", "write"],
      effect: "allow",
      conditions: { branchScoped: true },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "perm_analyst_security_read",
      tenantId: DEFAULT_TENANT_ID,
      role: "analyst",
      resource: "security",
      actions: ["read"],
      effect: "allow",
      conditions: { branchScoped: false },
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  const defaultRoleDefinitions = [
    {
      role: "owner",
      name: "Owner",
      description: "Full salon and SaaS tenant control.",
      permissions: [{ resource: "*", actions: ["read", "write", "admin"] }],
      isSystem: 1
    },
    {
      role: "manager",
      name: "Manager",
      description: "Operational manager for bookings, clients, staff, reports and approvals.",
      permissions: [
        { resource: "*", actions: ["read"] },
        { resource: "appointments", actions: ["write"] },
        { resource: "clients", actions: ["write"] },
        { resource: "sales", actions: ["write"] },
        { resource: "payments", actions: ["write"] },
        { resource: "staff", actions: ["write"] },
        { resource: "reports", actions: ["read"] },
        { resource: "security", actions: ["read"] }
      ],
      isSystem: 1
    },
    {
      role: "receptionist",
      name: "Receptionist",
      description: "Front desk access for quick booking, walk-ins, client lookup and POS payments.",
      permissions: [
        { resource: "*", actions: ["read"] },
        { resource: "appointments", actions: ["write"] },
        { resource: "clients", actions: ["write"] },
        { resource: "sales", actions: ["write"] },
        { resource: "payments", actions: ["write"] },
        { resource: "smart-booking", actions: ["write"] },
        { resource: "booking-portal", actions: ["write"] }
      ],
      isSystem: 1
    },
    {
      role: "frontDesk",
      name: "Front desk",
      description: "Legacy alias for receptionist.",
      permissions: [
        { resource: "*", actions: ["read"] },
        { resource: "appointments", actions: ["write"] },
        { resource: "clients", actions: ["write"] },
        { resource: "sales", actions: ["write"] },
        { resource: "payments", actions: ["write"] }
      ],
      isSystem: 1
    },
    {
      role: "staff",
      name: "Staff",
      description: "Personal appointment, service and customer context access.",
      permissions: [
        { resource: "appointments", actions: ["read", "write"] },
        { resource: "clients", actions: ["read"] },
        { resource: "services", actions: ["read"] },
        { resource: "customer-360", actions: ["read"] }
      ],
      isSystem: 1
    },
    {
      role: "accountant",
      name: "Accountant",
      description: "Finance, invoices, payments, refunds, GST, closing and payout access.",
      permissions: [
        { resource: "*", actions: ["read"] },
        { resource: "finance", actions: ["write"] },
        { resource: "invoices", actions: ["write"] },
        { resource: "payments", actions: ["write"] },
        { resource: "reports", actions: ["read"] },
        { resource: "security", actions: ["read"] }
      ],
      isSystem: 1
    },
    {
      role: "inventoryManager",
      name: "Inventory manager",
      description: "Product, supplier, batch, purchase, stock transfer and waste access.",
      permissions: [
        { resource: "*", actions: ["read"] },
        { resource: "products", actions: ["write"] },
        { resource: "inventory", actions: ["write"] },
        { resource: "inventory-intelligence", actions: ["write"] },
        { resource: "branches", actions: ["write"] }
      ],
      isSystem: 1
    },
    {
      role: "customMarketingLead",
      name: "Custom marketing lead",
      description: "Demo custom role managed through the permission matrix.",
      permissions: [
        { resource: "clients", actions: ["read"] },
        { resource: "marketing", actions: ["read", "write"] },
        { resource: "whatsapp", actions: ["read", "write"] },
        { resource: "ai-marketing", actions: ["read", "write"] }
      ],
      isSystem: 0
    }
  ];
  defaultRoleDefinitions.forEach((definition) => {
    seedIfMissing("role_definitions", `role_${definition.role}`, {
      id: `role_${definition.role}`,
      tenantId: DEFAULT_TENANT_ID,
      role: definition.role,
      name: definition.name,
      description: definition.description,
      permissions: definition.permissions,
      isSystem: definition.isSystem,
      status: "active",
      createdBy: "seed",
      createdAt: stamp,
      updatedAt: stamp
    });
    definition.permissions.forEach((permission) => {
      const resourceKey = permission.resource.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "all";
      seedIfMissing("security_permissions", `perm_${definition.role}_${resourceKey}`, {
        id: `perm_${definition.role}_${resourceKey}`,
        tenantId: DEFAULT_TENANT_ID,
        role: definition.role,
        resource: permission.resource,
        actions: permission.actions,
        effect: "allow",
        conditions: { branchScoped: !["owner", "manager", "accountant"].includes(definition.role) },
        createdAt: stamp,
        updatedAt: stamp
      });
    });
  });
  seedIfEmpty("white_label_profiles", [
    {
      id: "brand_aura_default",
      tenantId: DEFAULT_TENANT_ID,
      name: "Aura default brand",
      brandName: "Aura Salon",
      logoUrl: "/assets/aura-logo.svg",
      domain: "aura.localhost",
      theme: {
        primary: "#4B1238",
        accent: "#4B1238",
        surface: "#ffffff",
        ink: "#17202d"
      },
      assets: { invoiceLogo: "/assets/aura-logo.svg", bookingHero: "" },
      settings: { portalTitle: "Book your Aura appointment", invoiceFooter: "Thank you for visiting Aura Salon." },
      isDefault: 1,
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("workflow_definitions", [
    {
      id: "wf_inactive_30_offer",
      tenantId: DEFAULT_TENANT_ID,
      name: "Inactive 30-day WhatsApp win-back",
      description: "If a client is inactive for 30 days, send a comeback offer on WhatsApp.",
      trigger: { type: "client-inactive", schedule: "daily" },
      conditions: { inactiveDays: 30, minSpend: 0 },
      actions: [
        {
          channel: "WhatsApp",
          template: "Hi {{name}}, we miss you at Aura. Book this week and get a personalized glow offer."
        }
      ],
      delayMinutes: 0,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("subscriptions", [
    {
      id: "sub_aura_trial",
      tenantId: DEFAULT_TENANT_ID,
      planId: "plan_growth",
      status: "trialing",
      trialStart: stamp,
      trialEndsAt,
      currentPeriodStart: stamp,
      currentPeriodEnd: trialEndsAt,
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("tenant_users", [
    {
      id: "tu_aura_owner",
      tenantId: DEFAULT_TENANT_ID,
      name: "Aura Owner",
      email: "owner@aurasalon.example",
      role: "owner",
      branchIds: ["branch_hyd", "branch_blr"],
      ...seedPasswordFields(process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026", "aura-owner-seed-salt"),
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "system-user",
      tenantId: DEFAULT_TENANT_ID,
      name: "System Demo User",
      email: "system@aurasalon.example",
      role: "owner",
      branchIds: ["branch_hyd", "branch_blr"],
      ...seedPasswordFields(process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026", "aura-system-seed-salt"),
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  ensureTenantUserPassword("tu_aura_owner", process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026", "aura-owner-seed-salt");
  ensureTenantUserPassword("system-user", process.env.DEMO_ADMIN_PASSWORD || "AuraOwner#2026", "aura-system-seed-salt");
  seedIfEmpty("domain_mappings", [
    {
      id: "domain_aura_localhost",
      tenantId: DEFAULT_TENANT_ID,
      domain: "aura.localhost",
      status: "verified",
      isPrimary: 1,
      verifiedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("mobile_devices", [
    {
      id: "dev_owner_demo",
      tenantId: DEFAULT_TENANT_ID,
      userId: "tu_aura_owner",
      branchId: "branch_hyd",
      platform: "ios",
      deviceToken: "demo-mobile-device-token",
      pushProvider: "fcm",
      appVersion: "1.0.0",
      capabilities: { push: true, realtime: true, biometric: true },
      status: "active",
      lastSeenAt: stamp,
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("branches", [
    {
      id: "branch_hyd",
      name: "Aura Salon Jubilee Hills",
      city: "Hyderabad",
      address: "Road 36, Jubilee Hills",
      phone: "+91 90000 10101",
      gstin: "36AURAS1234F1Z5",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "branch_blr",
      name: "Aura Salon Indiranagar",
      city: "Bengaluru",
      address: "12th Main, Indiranagar",
      phone: "+91 90000 20202",
      gstin: "29AURAS1234F1Z6",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("branch_branding", [
    {
      id: "brand_branch_hyd",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      profileId: "brand_aura_default",
      brandName: "Aura Salon Jubilee Hills",
      logoUrl: "/assets/aura-logo.svg",
      theme: { primary: "#4B1238", accent: "#4B1238", bookingButton: "#4B1238" },
      assets: { qrPoster: "branch_hyd_qr" },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "brand_branch_blr",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_blr",
      profileId: "brand_aura_default",
      brandName: "Aura Salon Indiranagar",
      logoUrl: "/assets/aura-logo.svg",
      theme: { primary: "#4B1238", accent: "#4B1238", bookingButton: "#4B1238" },
      assets: { qrPoster: "branch_blr_qr" },
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("staff", [
    {
      id: "staff_aya",
      name: "Ayesha Khan",
      role: "Senior Stylist",
      phone: "+91 98888 12001",
      email: "ayesha@aurasalon.example",
      branchId: "branch_hyd",
      shift: "10:00-19:00",
      assignedServices: ["svc_haircut", "svc_color"],
      commissionRule: { servicePercent: 12, retailPercent: 6 },
      attendance: [{ date: "2026-05-10", status: "present" }],
      performance: { revenue: 18600, bookings: 8, rating: 4.8 },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "staff_neha",
      name: "Neha Rao",
      role: "Skin Therapist",
      phone: "+91 98888 12002",
      email: "neha@aurasalon.example",
      branchId: "branch_hyd",
      shift: "11:00-20:00",
      assignedServices: ["svc_facial", "svc_cleanup"],
      commissionRule: { servicePercent: 10, retailPercent: 5 },
      attendance: [{ date: "2026-05-10", status: "present" }],
      performance: { revenue: 14200, bookings: 6, rating: 4.7 },
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "staff_karan",
      name: "Karan Mehta",
      role: "Front Desk",
      phone: "+91 98888 12003",
      email: "karan@aurasalon.example",
      branchId: "branch_blr",
      shift: "09:30-18:30",
      assignedServices: [],
      commissionRule: { servicePercent: 0, retailPercent: 2 },
      attendance: [{ date: "2026-05-10", status: "present" }],
      performance: { revenue: 7400, bookings: 11, rating: 4.6 },
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("staff_attendance", [
    {
      id: "att_aya_20260510",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      staffId: "staff_aya",
      date: "2026-05-10",
      status: "present",
      clockIn: "09:52",
      clockOut: "19:12",
      minutesWorked: 560,
      overtimeMinutes: 20,
      notes: "Handled color bar bookings",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "att_neha_20260510",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      staffId: "staff_neha",
      date: "2026-05-10",
      status: "present",
      clockIn: "10:55",
      clockOut: "20:05",
      minutesWorked: 550,
      overtimeMinutes: 10,
      notes: "Skin therapy shift",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "att_karan_20260510",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_blr",
      staffId: "staff_karan",
      date: "2026-05-10",
      status: "present",
      clockIn: "09:20",
      clockOut: "18:40",
      minutesWorked: 560,
      overtimeMinutes: 20,
      notes: "Front desk and walk-ins",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("staff_shifts", [
    {
      id: "shift_aya_20260511",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      staffId: "staff_aya",
      date: "2026-05-11",
      startTime: "10:00",
      endTime: "19:00",
      role: "Senior Stylist",
      chair: "Chair 2",
      serviceIds: ["svc_haircut", "svc_color"],
      status: "planned",
      notes: "Color bookings preferred",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "shift_neha_20260511",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      staffId: "staff_neha",
      date: "2026-05-11",
      startTime: "11:00",
      endTime: "20:00",
      role: "Skin Therapist",
      chair: "Room 1",
      serviceIds: ["svc_facial", "svc_cleanup"],
      status: "planned",
      notes: "Facial room coverage",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "shift_karan_20260511",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_blr",
      staffId: "staff_karan",
      date: "2026-05-11",
      startTime: "09:30",
      endTime: "18:30",
      role: "Front Desk",
      chair: "Reception",
      serviceIds: [],
      status: "planned",
      notes: "Walk-in desk",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("clients", [
    {
      id: "client_riya",
      name: "Riya Sharma",
      phone: "+91 98765 43120",
      email: "riya@example.com",
      gender: "Female",
      birthday: "1994-08-18",
      anniversary: "2020-12-02",
      tags: ["VIP", "high spender"],
      notes: "Prefers Ayesha. Sends WhatsApp confirmations.",
      walletBalance: 1200,
      loyaltyPoints: 460,
      branchId: "branch_hyd",
      totalSpend: 48600,
      visitCount: 11,
      lastVisitAt: "2026-05-09T15:30:00.000Z",
      visitHistory: [{ date: "2026-05-09", services: ["Hair Color"], staff: "Ayesha Khan" }],
      purchaseHistory: [{ date: "2026-05-09", invoice: "INV-1001", amount: 6200 }],
      whatsappHistory: [{ date: "2026-05-08", message: "Appointment reminder sent", status: "delivered" }],
      consentForms: [{ name: "Hair color patch test", signedAt: "2026-04-20" }],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "client_dev",
      name: "Dev Patel",
      phone: "+91 98111 88720",
      email: "dev@example.com",
      gender: "Male",
      birthday: "1990-01-11",
      tags: ["new"],
      notes: "Walk-in converted to online booking account.",
      walletBalance: 0,
      loyaltyPoints: 70,
      branchId: "branch_blr",
      totalSpend: 7400,
      visitCount: 2,
      lastVisitAt: "2026-05-05T12:00:00.000Z",
      visitHistory: [{ date: "2026-05-05", services: ["Haircut"], staff: "Karan Mehta" }],
      purchaseHistory: [],
      whatsappHistory: [{ date: "2026-05-04", message: "Welcome offer", status: "read" }],
      consentForms: [],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "client_meera",
      name: "Meera Iyer",
      phone: "+91 99880 11223",
      email: "meera@example.com",
      gender: "Female",
      birthday: "1988-03-25",
      tags: ["inactive", "membership"],
      notes: "Win-back facial offer scheduled.",
      walletBalance: 500,
      loyaltyPoints: 210,
      branchId: "branch_hyd",
      totalSpend: 21600,
      visitCount: 6,
      lastVisitAt: "2026-03-14T10:30:00.000Z",
      visitHistory: [{ date: "2026-03-14", services: ["Hydra Facial"], staff: "Neha Rao" }],
      purchaseHistory: [{ date: "2026-03-14", invoice: "INV-0992", amount: 4500 }],
      whatsappHistory: [{ date: "2026-05-01", message: "We miss you offer", status: "delivered" }],
      consentForms: [{ name: "Facial consent", signedAt: "2026-03-14" }],
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("products", [
    {
      id: "prod_shampoo",
      name: "Keratin Shampoo 250ml",
      sku: "RET-KER-250",
      category: "Retail Haircare",
      usageType: "retail",
      supplier: "GlowSupply",
      branchId: "branch_hyd",
      stock: 18,
      lowStockThreshold: 6,
      expiryDate: "2027-01-31",
      unitCost: 420,
      price: 899,
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "prod_color",
      name: "Professional Color Tube",
      sku: "PRO-COL-001",
      category: "Professional Hair",
      usageType: "internal",
      supplier: "SalonPro",
      branchId: "branch_hyd",
      stock: 9,
      lowStockThreshold: 10,
      expiryDate: "2026-09-15",
      unitCost: 310,
      price: 0,
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "prod_serum",
      name: "Argan Serum 100ml",
      sku: "RET-ARG-100",
      category: "Retail Haircare",
      usageType: "retail",
      supplier: "GlowSupply",
      branchId: "branch_blr",
      stock: 4,
      lowStockThreshold: 5,
      expiryDate: "2026-07-20",
      unitCost: 520,
      price: 1199,
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "prod_mask",
      name: "Facial Mask Sachet",
      sku: "PRO-FAC-MASK",
      category: "Professional Skin",
      usageType: "internal",
      supplier: "Dermacare",
      branchId: "branch_hyd",
      stock: 42,
      lowStockThreshold: 12,
      expiryDate: "2026-08-30",
      unitCost: 90,
      price: 0,
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("suppliers", [
    {
      id: "sup_glowsupply",
      tenantId: DEFAULT_TENANT_ID,
      name: "GlowSupply",
      contactName: "Priya Nair",
      phone: "+91 90000 30001",
      email: "orders@glowsupply.example",
      gstin: "36GLOWP1234A1Z1",
      address: "Hyderabad distribution hub",
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "sup_salonpro",
      tenantId: DEFAULT_TENANT_ID,
      name: "SalonPro",
      contactName: "Rohan Shah",
      phone: "+91 90000 30002",
      email: "supply@salonpro.example",
      gstin: "29SALON1234B1Z2",
      address: "Bengaluru professional supplies",
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "sup_dermacare",
      tenantId: DEFAULT_TENANT_ID,
      name: "Dermacare",
      contactName: "Isha Menon",
      phone: "+91 90000 30003",
      email: "care@dermacare.example",
      gstin: "36DERMA1234C1Z3",
      address: "Hyderabad skincare warehouse",
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("inventory_batches", [
    {
      id: "batch_shampoo_001",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      productId: "prod_shampoo",
      supplierId: "sup_glowsupply",
      batchNumber: "GS-KER-2026-01",
      expiryDate: "2027-01-31",
      quantityReceived: 24,
      quantityAvailable: 18,
      unitCost: 420,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "batch_color_001",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      productId: "prod_color",
      supplierId: "sup_salonpro",
      batchNumber: "SP-COL-2026-04",
      expiryDate: "2026-09-15",
      quantityReceived: 14,
      quantityAvailable: 9,
      unitCost: 310,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "batch_serum_001",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_blr",
      productId: "prod_serum",
      supplierId: "sup_glowsupply",
      batchNumber: "GS-ARG-2026-02",
      expiryDate: "2026-07-20",
      quantityReceived: 10,
      quantityAvailable: 4,
      unitCost: 520,
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("services", [
    {
      id: "svc_haircut",
      name: "Signature Haircut",
      category: "Hair",
      price: 1200,
      durationMinutes: 45,
      assignedStaff: ["staff_aya"],
      requiredProducts: [],
      addOns: ["Hair wash", "Blow dry"],
      packageServices: [],
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "svc_color",
      name: "Global Hair Color",
      category: "Hair",
      price: 4800,
      durationMinutes: 120,
      assignedStaff: ["staff_aya"],
      requiredProducts: [{ productId: "prod_color", quantity: 1 }],
      addOns: ["Toner", "Hair spa"],
      packageServices: ["svc_haircut"],
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "svc_facial",
      name: "Hydra Glow Facial",
      category: "Skin",
      price: 3500,
      durationMinutes: 75,
      assignedStaff: ["staff_neha"],
      requiredProducts: [{ productId: "prod_mask", quantity: 1 }],
      addOns: ["LED therapy", "Neck massage"],
      packageServices: [],
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "svc_cleanup",
      name: "Express Cleanup",
      category: "Skin",
      price: 1600,
      durationMinutes: 40,
      assignedStaff: ["staff_neha"],
      requiredProducts: [{ productId: "prod_mask", quantity: 0.5 }],
      addOns: ["De-tan"],
      packageServices: [],
      gstRate: 18,
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("appointments", [
    {
      id: "appt_riya_today",
      clientId: "client_riya",
      staffId: "staff_aya",
      branchId: "branch_hyd",
      serviceIds: ["svc_color"],
      startAt: "2026-05-10T11:00:00.000Z",
      endAt: "2026-05-10T13:00:00.000Z",
      status: "booked",
      source: "online",
      onlineStatus: "confirmed",
      chair: "Chair 2",
      room: "Color Bar",
      notes: "Patch test done.",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "appt_dev_walkin",
      clientId: "client_dev",
      staffId: "staff_karan",
      branchId: "branch_blr",
      serviceIds: ["svc_haircut"],
      startAt: "2026-05-10T09:30:00.000Z",
      endAt: "2026-05-10T10:15:00.000Z",
      status: "arrived",
      source: "walk-in",
      onlineStatus: "not-online",
      chair: "Chair 1",
      room: "Main Floor",
      notes: "Quick checkout requested.",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("realtime_queue_items", [
    {
      id: "queue_walkin_demo",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_blr",
      clientId: "client_dev",
      appointmentId: "appt_dev_walkin",
      type: "walk-in",
      title: "Dev Patel walk-in checkout",
      priority: "normal",
      status: "waiting",
      assignedStaffId: "staff_karan",
      payload: { source: "front-desk", service: "Signature Haircut" },
      history: [{ at: stamp, status: "waiting", note: "Seeded live queue item" }],
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("memberships", [
    {
      id: "mem_meera_gold",
      clientId: "client_meera",
      planName: "Gold Glow 6",
      price: 18000,
      planCredits: 6,
      creditsRemaining: 3,
      serviceCredits: [{ serviceId: "svc_facial", credits: 3 }],
      validityDate: "2026-09-30",
      autoRenew: 1,
      loyaltyMultiplier: 1.25,
      status: "active",
      redeemHistory: [{ date: "2026-03-14", serviceId: "svc_facial", credits: 1 }],
      branchId: "branch_hyd",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  db.prepare("UPDATE clients SET membershipId = ? WHERE id = ?").run("mem_meera_gold", "client_meera");
  seedIfEmpty("packages", [
    {
      id: "pkg_glow_reset",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      name: "Glow Reset Package",
      description: "Three Hydra Facial visits with one styling add-on credit.",
      price: 15000,
      validityDays: 120,
      serviceIds: ["svc_facial", "svc_haircut"],
      packageCredits: [
        { serviceId: "svc_facial", credits: 3 },
        { serviceId: "svc_haircut", credits: 1 }
      ],
      rules: { transferable: false, autoRenewReady: true, loyaltyMultiplier: 1.2 },
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("commissions", [
    {
      id: "comm_karan_retail_service",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_blr",
      staffId: "staff_karan",
      name: "Karan service and retail commission",
      type: "hybrid",
      value: 10,
      rule: { servicePercent: 10, retailPercent: 5, minimumRevenue: 25000 },
      tiers: [
        { from: 25000, percent: 10 },
        { from: 50000, percent: 12 }
      ],
      metadata: { payoutCycle: "monthly", source: "seed" },
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("campaigns", [
    {
      id: "camp_birthday",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      name: "Birthday Glow Offer",
      channel: "WhatsApp",
      segmentRule: { occasion: "birthday", daysAhead: 7 },
      template: "Happy birthday {{name}}! Enjoy 20% off this week.",
      status: "scheduled",
      scheduledAt: "2026-05-11T09:00:00.000Z",
      sentCount: 0,
      conversionValue: 0,
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "camp_inactive",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      name: "Inactive Client Win-back",
      channel: "SMS",
      segmentRule: { tag: "inactive", minDaysSinceVisit: 45 },
      template: "We miss you at Aura. Book a facial and get a complimentary add-on.",
      status: "draft",
      scheduledAt: "",
      sentCount: 0,
      conversionValue: 0,
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("message_logs", [
    {
      id: "msg_birthday_preview",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "branch_hyd",
      campaignId: "camp_birthday",
      clientId: "client_meera",
      channel: "WhatsApp",
      recipient: "+919876500002",
      message: "Happy birthday Meera! Enjoy 20% off this week.",
      direction: "outbound",
      status: "queued",
      providerMessageId: "",
      payload: { template: "camp_birthday", variables: { name: "Meera" } },
      providerResponse: {},
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("audit_logs", [
    {
      id: "audit_seed_platform_ready",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      actorUserId: "system-user",
      action: "platform.seeded",
      entityType: "system",
      entityId: DEFAULT_TENANT_ID,
      severity: "info",
      details: { modules: ["crm", "pos", "inventory", "staff", "marketing", "saas"] },
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("marketing_workflows", [
    {
      id: "mw_inactive_winback",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      name: "Inactive client win-back",
      trigger: "client.inactive",
      channel: "WhatsApp",
      status: "active",
      triggerRule: { minDaysSinceVisit: 45, excludeTags: ["do-not-disturb"] },
      steps: [
        { day: 0, channel: "WhatsApp", template: "We miss you {{name}}. Come back for a glow refresh with a special add-on." },
        { day: 3, channel: "WhatsApp", template: "Your Aura win-back offer is still open this week." },
        { day: 7, channel: "Email", template: "Last call for your personalised salon offer." }
      ],
      metrics: { enrolled: 0, conversions: 0, revenue: 0 },
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("marketing_sequences", [
    {
      id: "seq_birthday_glow",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      name: "Birthday glow sequence",
      channel: "WhatsApp",
      campaignId: "camp_birthday",
      audienceRule: { occasion: "birthday", daysAhead: 7 },
      steps: [
        { day: -7, body: "Birthday week starts soon, {{name}}. Your Aura glow offer is ready." },
        { day: 0, body: "Happy birthday {{name}}. Enjoy your special salon treat." },
        { day: 3, body: "Your birthday offer is valid this week." }
      ],
      status: "active",
      metrics: { sent: 0, clicked: 0, booked: 0 },
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("email_templates", [
    {
      id: "email_festival_offer",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      name: "Festival glow offer",
      subject: "{{festival}} glow packages at Aura Salon",
      body: "Hi {{name}}, celebrate {{festival}} with curated hair, skin and retail offers from Aura Salon.",
      purpose: "festival-campaign",
      variables: ["name", "festival", "offer", "bookingLink"],
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("settings", [
    {
      id: "setting_tax",
      key: "tax",
      value: { gstRate: 18, gstinRequired: true, placeOfSupply: "IN" },
      scope: "global",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "setting_payments",
      key: "payments",
      value: { cash: true, upi: true, card: true, wallet: true, splitPayment: true },
      scope: "global",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "setting_invoice",
      key: "invoice",
      value: { prefix: "AURA", printFooter: "Thank you for visiting Aura Salon" },
      scope: "global",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "setting_hours",
      key: "workingHours",
      value: { open: "10:00", close: "21:00", weeklyOff: "Tuesday" },
      scope: "global",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("gift_cards", [
    {
      id: "gift_mothersday",
      code: "AURA-MOM-5000",
      clientId: "client_riya",
      initialValue: 5000,
      balance: 5000,
      expiryDate: "2026-12-31",
      status: "active",
      redeemHistory: [],
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("coupon_codes", [
    {
      id: "coupon_glow10",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      code: "GLOW10",
      name: "Glow 10 percent offer",
      type: "percentage",
      value: 10,
      maxDiscount: 1000,
      minSubtotal: 1000,
      startsAt: "2026-01-01",
      endsAt: "2026-12-31",
      usageLimit: 1000,
      usedCount: 0,
      rules: { channels: ["front-desk", "online"], firstPurchaseOnly: false },
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "coupon_WELCOME500",
      tenantId: DEFAULT_TENANT_ID,
      branchId: "",
      code: "WELCOME500",
      name: "Welcome fixed discount",
      type: "fixed",
      value: 500,
      maxDiscount: 500,
      minSubtotal: 2500,
      startsAt: "2026-01-01",
      endsAt: "2026-12-31",
      usageLimit: 500,
      usedCount: 0,
      rules: { tags: ["new"] },
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("whatsapp_automation_rules", [
    {
      id: "wa_rule_auto_reply",
      tenantId: DEFAULT_TENANT_ID,
      name: "Auto reply to inbound leads",
      trigger: "inbound.message",
      template: "Hi {{name}}, thanks for messaging Aura Salon. Tell us the service and preferred time, and our front desk will help you book.",
      status: "active",
      delayMinutes: 0,
      conditions: { intents: ["booking", "pricing", "campaign_interest", "unknown"] },
      actions: ["detect-intent", "qualify-lead", "send-auto-reply"],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "wa_rule_booking_confirm",
      tenantId: DEFAULT_TENANT_ID,
      name: "Booking confirmation",
      trigger: "appointment.booked",
      template: "Hi {{name}}, your {{service}} appointment is confirmed for {{time}} at {{branch}}.",
      status: "active",
      delayMinutes: 0,
      conditions: { appointmentStatus: "booked" },
      actions: ["send-confirmation"],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "wa_rule_reminder",
      tenantId: DEFAULT_TENANT_ID,
      name: "Appointment reminder",
      trigger: "appointment.reminder",
      template: "Hi {{name}}, reminder for your {{service}} appointment at {{time}}. Reply 1 to confirm or call us to reschedule.",
      status: "active",
      delayMinutes: 1440,
      conditions: { hoursAhead: 24 },
      actions: ["send-reminder"],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "wa_rule_payment",
      tenantId: DEFAULT_TENANT_ID,
      name: "Payment reminder",
      trigger: "invoice.pending",
      template: "Hi {{name}}, your invoice {{invoiceNumber}} has a pending balance of ₹{{balance}}. You can pay by UPI or at the salon.",
      status: "active",
      delayMinutes: 0,
      conditions: { invoiceStatus: ["unpaid", "partial"] },
      actions: ["send-payment-reminder"],
      createdAt: stamp,
      updatedAt: stamp
    },
    {
      id: "wa_rule_birthday",
      tenantId: DEFAULT_TENANT_ID,
      name: "Birthday wishes",
      trigger: "client.birthday",
      template: "Happy birthday {{name}}! Aura Salon wishes you a beautiful year. Enjoy a special birthday glow offer this week.",
      status: "active",
      delayMinutes: 0,
      conditions: { occasion: "birthday" },
      actions: ["send-birthday-wish"],
      createdAt: stamp,
      updatedAt: stamp
    }
  ]);
  seedIfEmpty("voice_call_logs", [{ id: "voice_call_booking_1", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", clientId: "client_riya", phone: "+919876500001", language: "hi-IN", intent: "booking", transcript: [{ speaker: "client", text: "Hair spa booking chahiye" }], entities: { serviceIntent: "hair spa" }, actions: [{ type: "recommend-slot" }], providerPayload: { provider: "manual-sandbox" }, status: "resolved", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("queue_displays", [{ id: "queue_display_hyd_tv", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", name: "Hyderabad Queue TV", displayCode: "HYD-TV-01", layout: { mode: "tv", showWaitTime: true }, filters: { statuses: ["waiting", "in-service"] }, theme: { accent: "teal" }, status: "active", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("dynamic_pricing_rules", [{ id: "price_peak_weekend", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", name: "Weekend peak optimizer", scope: "services", conditions: { days: ["Saturday", "Sunday"], hours: ["16:00-20:00"] }, adjustments: { type: "percentage", value: 8, maxIncrease: 500 }, approval: { required: true, role: "owner" }, status: "active", startsAt: "2026-05-01", endsAt: "2026-12-31", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("growth_advisor_tasks", [{ id: "growth_task_reactivation", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", title: "Reactivate dormant high-LTV clients", priority: "high", ownerUserId: "tu_aura_owner", dueDate: "2026-05-20", signals: { inactiveClients: 12 }, recommendations: ["Launch win-back WhatsApp offer", "Add facial upgrade bundle"], outcomes: { expectedRevenue: 42000 }, status: "open", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("franchises", [{ id: "franchise_pune_001", tenantId: DEFAULT_TENANT_ID, name: "Aura Pune Franchise", ownerName: "Priya Shah", ownerEmail: "priya.franchise@example.com", territory: { city: "Pune", radiusKm: 8 }, status: "onboarding", royaltyPercent: 7, complianceScore: 92, complianceChecklist: [{ item: "Brand training", status: "passed" }], sharedTemplates: ["invoice", "festival-campaign"], createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("franchise_royalties", [{ id: "royalty_pune_may", tenantId: DEFAULT_TENANT_ID, franchiseId: "franchise_pune_001", periodStart: "2026-05-01", periodEnd: "2026-05-31", grossRevenue: 850000, royaltyAmount: 59500, calculation: { percent: 7 }, payments: [], status: "pending", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("training_lessons", [{ id: "lesson_consultation_basics", tenantId: DEFAULT_TENANT_ID, title: "Consultation and Upsell Basics", category: "front-desk", level: "intermediate", durationMinutes: 35, content: { videoUrl: "https://training.local/consultation" }, attachments: [], quiz: { passPercent: 80, questions: 5 }, status: "published", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("training_assignments", [{ id: "assign_aya_consultation", tenantId: DEFAULT_TENANT_ID, lessonId: "lesson_consultation_basics", staffId: "staff_aya", dueDate: "2026-05-25", progress: { percent: 40 }, quizResult: {}, certificate: {}, status: "in-progress", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("image_analyses", [{ id: "image_skin_riya", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", clientId: "client_riya", analysisType: "skin", imageUri: "secure://client_riya/skin-before", input: { consentId: "consent_riya" }, findings: { hydration: "low", sensitivity: "medium" }, recommendations: [{ serviceId: "svc_facial", reason: "Hydration boost" }], consent: { granted: true, purpose: "consultation" }, status: "generated", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("reputation_reviews", [{ id: "review_google_riya", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", platform: "Google", reviewer: "Riya S", rating: 4.5, reviewText: "Great service and clean salon", sentiment: "positive", metadata: { externalId: "google-001" }, aiReply: { text: "Thank you for visiting Aura Salon!" }, alerts: [], status: "replied", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("marketplace_connections", [{ id: "conn_google_calendar", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", provider: "Google Calendar", accountName: "hyd-calendar@aurasalon.example", credentials: { vaultRef: "encrypted_secret_google_calendar" }, scopes: ["calendar.events"], health: { status: "healthy" }, status: "connected", lastSyncAt: stamp, createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("gamification_events", [{ id: "game_staff_aya_upsell", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", subjectType: "staff", subjectId: "staff_aya", eventType: "upsell-win", points: { earned: 50, balance: 450 }, badges: ["consultation-star"], metadata: { saleId: "sale_seed" }, createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("fraud_alerts", [{ id: "fraud_refund_watch", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", alertType: "refund-spike", severity: "medium", subjectType: "staff", subjectId: "staff_karan", riskScore: 62, signals: { refundsThisWeek: 4 }, evidence: ["Refund count above branch median"], resolution: {}, status: "open", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("smart_forms", [{ id: "form_skin_consult", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", name: "Skin Consultation Form", formType: "consultation", version: 1, schema: { fields: [{ key: "allergies", type: "text" }] }, rules: { requireBeforeFacial: true }, signatureConfig: { required: true }, status: "active", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("form_responses", [{ id: "form_resp_riya_skin", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", formId: "form_skin_consult", clientId: "client_riya", appointmentId: "", answers: { allergies: "None" }, signature: { signedBy: "Riya", signedAt: stamp }, metadata: { device: "front-desk" }, status: "submitted", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("recommendation_events", [{ id: "rec_riya_next_service", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", clientId: "client_riya", type: "next-service", input: { lastService: "facial" }, recommendations: [{ serviceId: "svc_facial", score: 91 }], feedback: {}, status: "generated", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("warehouse_snapshots", [{ id: "warehouse_daily_hyd", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", snapshotType: "daily-ops", periodStart: "2026-05-01", periodEnd: "2026-05-12", dimensions: { branch: "branch_hyd" }, facts: { sales: 12, bookings: 33 }, aggregates: { revenue: 185000 }, status: "materialized", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("kpi_monitors", [{ id: "kpi_revenue_hour", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", name: "Revenue per Hour", metric: "revenue_per_hour", target: { min: 4500 }, current: { value: 5200 }, alerts: [], status: "active", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("appointment_optimizations", [{ id: "appt_opt_gap_hyd", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", optimizationType: "gap-reduction", input: { date: "2026-05-12" }, recommendations: [{ action: "move", expectedGapReductionMinutes: 45 }], appliedChanges: [], score: 78, status: "generated", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("api_keys", [{ id: "api_key_partner_demo", tenantId: DEFAULT_TENANT_ID, name: "Partner Demo API Key", keyPrefix: "aura_demo", keyHash: "sha256:seeded-demo-key-hash", scopes: ["bookings:read", "clients:read"], rateLimits: { perMinute: 120 }, metadata: { owner: "partner" }, status: "active", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("webhooks", [{ id: "webhook_booking_created", tenantId: DEFAULT_TENANT_ID, name: "Booking Created Webhook", url: "https://partner.example/webhooks/aura", events: ["appointment.created"], headers: { authorization: "vault:webhook-token" }, retryPolicy: { maxAttempts: 5 }, lastDelivery: {}, status: "active", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("forecasting_models", [{ id: "forecast_revenue_30d", tenantId: DEFAULT_TENANT_ID, branchId: "branch_hyd", name: "30-day Revenue Forecast", modelType: "revenue", horizonDays: 30, features: { seasonality: true, campaigns: true }, metrics: { mape: 12.5 }, predictions: [{ date: "2026-05-13", revenue: 25000 }], status: "active", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("knowledge_base_articles", [{ id: "kb_refund_sop", tenantId: DEFAULT_TENANT_ID, title: "Refund and Credit Note SOP", audience: "staff", category: "finance", body: "Validate invoice, manager approval, issue credit note, record audit.", tags: ["refund", "finance"], contentBlocks: [{ type: "step", text: "Check invoice status" }], embeddingMetadata: { indexed: false }, status: "published", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("plugin_manifests", [{ id: "plugin_razorpay_stub", tenantId: DEFAULT_TENANT_ID, name: "Razorpay Payments", version: "1.0.0", vendor: "Aura", permissions: ["payments.write"], extensionPoints: ["pos.payment"], settings: { mode: "sandbox" }, status: "installed", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("app_marketplace_apps", [{ id: "app_instagram_leads", tenantId: DEFAULT_TENANT_ID, name: "Instagram Lead Sync", category: "social", provider: "Aura Marketplace", features: ["lead-import", "campaign-attribution"], pricing: { monthly: 999 }, installState: { installed: false }, status: "available", createdAt: stamp, updatedAt: stamp }]);
  seedIfEmpty("localization_profiles", [{ id: "loc_india_uae", tenantId: DEFAULT_TENANT_ID, name: "India + UAE Expansion", primaryCountry: "IN", countries: ["IN", "AE"], currencies: ["INR", "AED"], taxRules: { IN: "GST", AE: "VAT" }, translations: { en: "English", hi: "Hindi", ar: "Arabic" }, status: "active", createdAt: stamp, updatedAt: stamp }]);
}

seedDatabase();
