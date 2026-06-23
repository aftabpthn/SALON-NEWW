import { columnsFor, db, tenantScopedTables } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { tenantService } from "./tenant.service.js";
import { realtimeService } from "./realtime.service.js";
import { authService } from "./auth.service.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const pct = (value) => Math.round((Number(value) || 0) * 100) / 100;
const TENANT_LIMITS_KEY = "superAdminTenantLimits";
const TENANT_IP_ALLOWLIST_KEY = "superAdminIpAllowlist";
const TENANT_DATA_EXPORT_CONTROLS_KEY = "superAdminDataExportControls";
const TENANT_ROLE_PERMISSION_MATRIX_KEY = "superAdminRolePermissionMatrix";

function ensureSuperAdmin(access = {}) {
  if (access.role !== "superAdmin") throw forbidden("Super admin access is required");
}

function count(table, tenantId = "") {
  if (tenantId) return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenantId = ?`).get(tenantId).count;
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function sumRows(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function share(part, total) {
  return total ? pct((Number(part || 0) / total) * 100) : 0;
}

function tenantLimitValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function planLimitsFor(plan = {}) {
  const limits = plan?.limits || {};
  return {
    branches: tenantLimitValue(limits.branches, 3),
    staff: tenantLimitValue(limits.staff, 25),
    clients: tenantLimitValue(limits.clients, 5000),
    monthlyAppointments: tenantLimitValue(limits.monthlyAppointments, 8000),
    campaigns: tenantLimitValue(limits.campaigns, 50),
    supportTier: limits.supportTier || "standard"
  };
}

function tenantLimitsFor(plan, override = {}, usage = {}) {
  const limits = { ...planLimitsFor(plan), ...(override || {}) };
  return {
    ...limits,
    utilization: {
      branches: share(usage.branches, Math.max(1, limits.branches)),
      staff: share(usage.staff, Math.max(1, limits.staff)),
      clients: share(usage.clients, Math.max(1, limits.clients))
    }
  };
}

function parseIpAllowlist(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const entries = Array.isArray(source.entries)
    ? source.entries
    : String(source.entriesText || "").split(/\r?\n|,/);
  return {
    enabled: Boolean(source.enabled),
    mode: source.mode === "monitor" ? "monitor" : "enforce",
    entries: entries
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .slice(0, 100),
    reason: source.reason || "",
    updatedBy: source.updatedBy || "",
    updatedAt: source.updatedAt || ""
  };
}

function ipAllowlistForTenant(policy = {}) {
  const parsed = parseIpAllowlist(policy);
  return {
    ...parsed,
    status: !parsed.enabled ? "disabled" : parsed.entries.length ? parsed.mode : "empty",
    summary: !parsed.enabled
      ? "IP allowlist disabled"
      : parsed.entries.length
        ? `${parsed.entries.length} IP/CIDR entries`
        : "Enabled without entries"
  };
}

function parseDataExportControls(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const allowedFormats = Array.isArray(source.allowedFormats)
    ? source.allowedFormats
    : String(source.formatsText || source.allowedFormatsText || "csv,xlsx,pdf").split(/\r?\n|,/);
  const maxRows = Math.max(100, Math.min(1000000, Math.round(Number(source.maxRows || 50000))));
  const retentionDays = Math.max(1, Math.min(365, Math.round(Number(source.retentionDays || 30))));
  return {
    enabled: source.enabled !== false,
    approvalRequired: source.approvalRequired !== false,
    piiMasking: source.piiMasking !== false,
    watermark: Boolean(source.watermark),
    allowedFormats: allowedFormats
      .map((format) => String(format || "").trim().toLowerCase())
      .filter(Boolean)
      .filter((format, index, formats) => formats.indexOf(format) === index)
      .slice(0, 10),
    maxRows,
    retentionDays,
    reason: source.reason || "",
    updatedBy: source.updatedBy || "",
    updatedAt: source.updatedAt || ""
  };
}

function dataExportControlsForTenant(policy = {}) {
  const parsed = parseDataExportControls(policy);
  const restricted = parsed.enabled && parsed.approvalRequired && parsed.piiMasking;
  return {
    ...parsed,
    status: !parsed.enabled ? "disabled" : restricted ? "restricted" : "open",
    summary: !parsed.enabled
      ? "Exports disabled"
      : `${parsed.allowedFormats.join(", ") || "no formats"} · ${parsed.maxRows} rows · ${parsed.retentionDays}d retention`
  };
}

const ROLE_PERMISSION_MODULES = [
  { key: "bookings", label: "Bookings", permissions: ["read", "write", "approve"] },
  { key: "clients", label: "Clients", permissions: ["read", "write", "export"] },
  { key: "billing", label: "Billing", permissions: ["read", "write", "refund"] },
  { key: "staff", label: "Staff", permissions: ["read", "write", "payroll"] },
  { key: "reports", label: "Reports", permissions: ["read", "export"] },
  { key: "settings", label: "Settings", permissions: ["read", "write"] }
];

const DEFAULT_ROLE_PERMISSION_MATRIX = {
  owner: [
    "bookings.read", "bookings.write", "bookings.approve",
    "clients.read", "clients.write", "clients.export",
    "billing.read", "billing.write", "billing.refund",
    "staff.read", "staff.write", "staff.payroll",
    "reports.read", "reports.export",
    "settings.read", "settings.write"
  ],
  admin: [
    "bookings.read", "bookings.write", "bookings.approve",
    "clients.read", "clients.write",
    "billing.read", "billing.write",
    "staff.read", "staff.write",
    "reports.read", "reports.export",
    "settings.read"
  ],
  manager: ["bookings.read", "bookings.write", "bookings.approve", "clients.read", "clients.write", "billing.read", "staff.read", "reports.read"],
  cashier: ["bookings.read", "bookings.write", "clients.read", "billing.read", "billing.write"],
  accountant: ["billing.read", "billing.write", "reports.read", "reports.export"],
  staff: ["bookings.read", "clients.read"]
};

const VALID_PERMISSION_KEYS = new Set(ROLE_PERMISSION_MODULES.flatMap((module) => module.permissions.map((permission) => `${module.key}.${permission}`)));

function normalizePermissionList(value) {
  const entries = Array.isArray(value) ? value : String(value || "").split(/\r?\n|,/);
  return entries
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => VALID_PERMISSION_KEYS.has(entry))
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, 100);
}

function parseRolePermissionMatrix(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const roles = Object.fromEntries(Object.entries(DEFAULT_ROLE_PERMISSION_MATRIX).map(([role, permissions]) => [role, [...permissions]]));
  const sourceRoles = source.roles && typeof source.roles === "object" ? source.roles : {};
  for (const [role, permissions] of Object.entries(sourceRoles)) {
    const key = String(role || "").trim().toLowerCase();
    if (!key) continue;
    roles[key] = normalizePermissionList(permissions);
  }
  if (source.role) {
    const role = String(source.role || "").trim().toLowerCase();
    roles[role] = normalizePermissionList(source.permissions || source.permissionsText);
  }
  return {
    roles,
    reason: source.reason || "",
    updatedBy: source.updatedBy || "",
    updatedAt: source.updatedAt || ""
  };
}

function rolePermissionMatrixForTenant(policy = {}) {
  const parsed = parseRolePermissionMatrix(policy);
  const roleRows = Object.entries(parsed.roles)
    .map(([role, permissions]) => ({
      role,
      permissions,
      permissionCount: permissions.length,
      modules: ROLE_PERMISSION_MODULES.map((module) => ({
        ...module,
        granted: module.permissions.filter((permission) => permissions.includes(`${module.key}.${permission}`)).length,
        total: module.permissions.length
      }))
    }))
    .sort((a, b) => b.permissionCount - a.permissionCount || a.role.localeCompare(b.role));
  const totalPermissions = sumRows(roleRows, (row) => row.permissionCount);
  const privilegedRoles = roleRows.filter((row) => row.permissions.includes("billing.refund") || row.permissions.includes("settings.write")).map((row) => row.role);
  return {
    ...parsed,
    modules: ROLE_PERMISSION_MODULES,
    roleRows,
    roleCount: roleRows.length,
    totalPermissions,
    privilegedRoles,
    summary: `${roleRows.length} roles · ${totalPermissions} grants · ${privilegedRoles.length} privileged`
  };
}

function enterpriseSecurityForTenant(plan = {}, tenantLimits = {}, ipAllowlist = {}, sso = {}, dataExportControls = {}) {
  const enterpriseTenant = String(plan?.code || "").toLowerCase() === "enterprise" || tenantLimits.supportTier === "enterprise";
  const dataExportLocked = dataExportControls.enabled && dataExportControls.approvalRequired && dataExportControls.piiMasking;
  return {
    enterpriseTenant,
    ipRestrictionRequired: enterpriseTenant,
    ipRestrictionStatus: !enterpriseTenant
      ? "not_required"
      : ipAllowlist.enabled && ipAllowlist.entries.length && ipAllowlist.mode === "enforce"
        ? "enforced"
        : ipAllowlist.enabled && ipAllowlist.entries.length
          ? "monitoring"
          : "gap",
    ssoStatus: sso.status || "not_configured",
    ssoProvider: sso.provider || "saml",
    dataExportStatus: !enterpriseTenant ? "not_required" : dataExportLocked ? "restricted" : "gap",
    ready: !enterpriseTenant || ((ipAllowlist.enabled && ipAllowlist.entries.length && ipAllowlist.mode === "enforce") && ["active", "enforced", "ready"].includes(sso.status || "") && dataExportLocked)
  };
}

function latestSsoByTenant() {
  const rows = db.prepare("SELECT * FROM security_sso_settings ORDER BY updatedAt DESC").all();
  const byTenant = new Map();
  for (const row of rows) {
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, row);
  }
  return byTenant;
}

function rowsByTenant(table, orderColumn = "createdAt", limit = 1000) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderColumn} DESC LIMIT @limit`).all({ limit });
  const byTenant = new Map();
  for (const row of rows) {
    const tenantId = row.tenantId || "";
    if (!tenantId) continue;
    if (!byTenant.has(tenantId)) byTenant.set(tenantId, []);
    byTenant.get(tenantId).push(row);
  }
  return byTenant;
}

function parseBranchIds(value) {
  const parsed = normalizeRules(value);
  if (Array.isArray(parsed)) return parsed.map((item) => String(item || "")).filter(Boolean);
  return String(value || "").split(",").map((item) => item.replace(/[\[\]"]/g, "").trim()).filter(Boolean);
}

function geoBucketForIp(ipAddress = "") {
  const ip = String(ipAddress || "").trim();
  if (!ip) return { key: "unknown", label: "Unknown location", country: "Unknown", city: "", publicNetwork: false };
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|127\.|::1|fc00:|fd00:)/i.test(ip)) {
    return { key: "private-network", label: "Private/VPN network", country: "Private", city: "VPN/LAN", publicNetwork: false };
  }
  const first = Number(ip.split(".")[0]);
  if (Number.isFinite(first)) {
    if (first >= 1 && first <= 49) return { key: "apac-public", label: "APAC public IP", country: "APAC", city: "", publicNetwork: true };
    if (first >= 50 && first <= 99) return { key: "amer-public", label: "Americas public IP", country: "Americas", city: "", publicNetwork: true };
    if (first >= 100 && first <= 185) return { key: "emea-public", label: "EMEA public IP", country: "EMEA", city: "", publicNetwork: true };
  }
  return { key: "public-network", label: "Public network", country: "Public", city: "", publicNetwork: true };
}

function suspiciousLoginScore(row = {}) {
  const reasons = [];
  let score = 0;
  const riskLevel = String(row.riskLevel || "").toLowerCase();
  const geo = geoBucketForIp(row.ipAddress);
  const hour = new Date(row.occurredAt || "").getHours();
  if (row.source === "risk_event") {
    score += riskLevel === "critical" ? 60 : riskLevel === "high" ? 45 : riskLevel === "medium" ? 30 : 18;
    reasons.push(`${riskLevel || "risk"} event`);
  }
  if (riskLevel === "observed" || riskLevel === "untrusted" || riskLevel === "watch") {
    score += 18;
    reasons.push("untrusted device");
  }
  if (Number(row.failedLoginCount || 0) > 0) {
    score += Math.min(30, Number(row.failedLoginCount || 0) * 6);
    reasons.push(`${row.failedLoginCount} failed logins`);
  }
  if (geo.publicNetwork && row.source === "trusted_device" && riskLevel !== "trusted") {
    score += 12;
    reasons.push("public IP not trusted");
  }
  if (Number.isFinite(hour) && (hour < 6 || hour > 22)) {
    score += 10;
    reasons.push("odd-hour login");
  }
  const level = score >= 75 ? "critical" : score >= 50 ? "suspicious" : score >= 25 ? "watch" : "normal";
  return { score: Math.min(100, score), level, reasons, geo };
}

function loginActivityMap(tenantUsers = [], trustedDevices = [], riskEvents = []) {
  const usersById = new Map(tenantUsers.map((user) => [user.id, user]));
  const rows = [
    ...tenantUsers
      .filter((user) => user.lastLoginAt)
      .map((user) => ({
        userId: user.id,
        userName: user.name || user.email || user.id,
        role: user.role || "",
        branchId: parseBranchIds(user.branchIds)[0] || "",
        ipAddress: "",
        riskLevel: user.failedLoginCount > 0 ? "watch" : "low",
        failedLoginCount: Number(user.failedLoginCount || 0),
        source: "tenant_user",
        occurredAt: user.lastLoginAt
      })),
    ...trustedDevices.map((device) => {
      const user = usersById.get(device.userId) || {};
      return {
        userId: device.userId || "",
        userName: user.name || user.email || device.userId || "Unknown user",
        role: user.role || "",
        branchId: device.branchId || parseBranchIds(user.branchIds)[0] || "",
        ipAddress: device.ipAddress || "",
        riskLevel: device.trustLevel || device.status || "observed",
        source: "trusted_device",
        occurredAt: device.lastSeenAt || device.updatedAt || device.createdAt || ""
      };
    }),
    ...riskEvents.map((event) => {
      const user = usersById.get(event.userId) || {};
      return {
        userId: event.userId || "",
        userName: user.name || user.email || event.userId || "Unknown user",
        role: user.role || "",
        branchId: event.branchId || parseBranchIds(user.branchIds)[0] || "",
        ipAddress: event.ipAddress || "",
        riskLevel: event.riskLevel || "low",
        source: "risk_event",
        occurredAt: event.createdAt || event.updatedAt || ""
      };
    })
  ].filter((row) => row.occurredAt).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const enrichedRows = rows.map((row) => ({ ...row, ...suspiciousLoginScore(row) }));
  const locations = new Map();
  const geoBuckets = new Map();
  for (const row of enrichedRows) {
    const key = row.branchId || "tenant-wide";
    if (!locations.has(key)) {
      locations.set(key, {
        key,
        label: row.branchId ? `Branch ${row.branchId}` : "Tenant wide",
        value: 0,
        users: new Set(),
        ipAddresses: new Set(),
        riskEvents: 0,
        suspicious: 0,
        lastSeenAt: ""
      });
    }
    const item = locations.get(key);
    item.value += 1;
    if (row.userName) item.users.add(row.userName);
    if (row.ipAddress) item.ipAddresses.add(row.ipAddress);
    if (row.source === "risk_event") item.riskEvents += 1;
    if (["critical", "suspicious"].includes(row.level)) item.suspicious += 1;
    if (!item.lastSeenAt || String(row.occurredAt).localeCompare(String(item.lastSeenAt)) > 0) item.lastSeenAt = row.occurredAt;
    const geoKey = row.geo?.key || "unknown";
    if (!geoBuckets.has(geoKey)) {
      geoBuckets.set(geoKey, {
        key: geoKey,
        label: row.geo?.label || "Unknown location",
        country: row.geo?.country || "Unknown",
        city: row.geo?.city || "",
        value: 0,
        suspicious: 0,
        critical: 0,
        users: new Set(),
        ipAddresses: new Set(),
        lastSeenAt: ""
      });
    }
    const geoItem = geoBuckets.get(geoKey);
    geoItem.value += 1;
    if (["critical", "suspicious"].includes(row.level)) geoItem.suspicious += 1;
    if (row.level === "critical") geoItem.critical += 1;
    if (row.userName) geoItem.users.add(row.userName);
    if (row.ipAddress) geoItem.ipAddresses.add(row.ipAddress);
    if (!geoItem.lastSeenAt || String(row.occurredAt).localeCompare(String(geoItem.lastSeenAt)) > 0) geoItem.lastSeenAt = row.occurredAt;
  }
  const suspiciousRows = enrichedRows.filter((row) => ["critical", "suspicious", "watch"].includes(row.level));
  return {
    activeUsers: tenantUsers.filter((user) => user.lastLoginAt).length,
    trustedDevices: trustedDevices.length,
    riskEvents: riskEvents.length,
    suspiciousLogins: suspiciousRows.length,
    criticalLogins: enrichedRows.filter((row) => row.level === "critical").length,
    lastSeenAt: enrichedRows[0]?.occurredAt || "",
    locations: [...locations.values()].map((item) => ({
      ...item,
      users: [...item.users].slice(0, 4),
      ipAddresses: [...item.ipAddresses].slice(0, 4)
    })).sort((a, b) => b.value - a.value).slice(0, 8),
    geoMap: [...geoBuckets.values()].map((item) => ({
      ...item,
      users: [...item.users].slice(0, 4),
      ipAddresses: [...item.ipAddresses].slice(0, 4)
    })).sort((a, b) => b.critical - a.critical || b.suspicious - a.suspicious || b.value - a.value).slice(0, 8),
    suspiciousActivity: suspiciousRows.slice(0, 8),
    recentActivity: enrichedRows.slice(0, 12)
  };
}

function exportManifestForTenant(tenantId) {
  const tables = [];
  let totalRows = 0;
  for (const table of tenantScopedTables) {
    try {
      const columns = columnsFor(table);
      const tenantColumn = columns.includes("tenantId") ? "tenantId" : columns.includes("tenant_id") ? "tenant_id" : "";
      if (!tenantColumn) continue;
      const countRow = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${tenantColumn} = @tenantId`).get({ tenantId });
      const rows = Number(countRow?.count || 0);
      if (!rows) continue;
      totalRows += rows;
      tables.push({ table, rows });
    } catch {
      // Export manifest should not block request creation if a legacy table is unavailable.
    }
  }
  return {
    totalTables: tables.length,
    totalRows,
    tables: tables.sort((a, b) => b.rows - a.rows).slice(0, 25)
  };
}

function scopedFeatureKey(key, scope, tenantId = "", planId = "") {
  const cleanKey = String(key || "").trim();
  if (scope === "tenant" && tenantId && !cleanKey.includes("::tenant::")) return `${cleanKey}::tenant::${tenantId}`;
  if (scope === "plan" && planId && !cleanKey.includes("::plan::")) return `${cleanKey}::plan::${planId}`;
  return cleanKey;
}

function baseFeatureKey(toggle = {}) {
  return normalizeRules(toggle.rules).baseKey || String(toggle.key || "").split("::tenant::")[0].split("::plan::")[0];
}

function tenantHealth(tenant, rows) {
  const overdue = tenant.subscriptionStatus === "suspended" || tenant.status === "suspended";
  const activityScore = Math.min(100, rows.appointments * 5 + rows.sales * 8 + rows.clients * 2);
  const subscriptionScore = overdue ? 5 : tenant.subscriptionStatus === "trialing" ? 72 : 95;
  return pct((activityScore + subscriptionScore) / 2);
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const target = new Date(dateValue).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86400000);
}

function daysSince(dateValue) {
  if (!dateValue) return null;
  const target = new Date(dateValue).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.floor((Date.now() - target) / 86400000));
}

function healthBreakdown(tenant, usage, outstanding, monthlyRecurringRevenue) {
  const subscriptionScore = tenant.subscriptionStatus === "suspended" || tenant.status === "suspended"
    ? 5
    : tenant.subscriptionStatus === "trialing"
      ? 72
      : 95;
  const usageScore = Math.min(100, usage.appointments * 5 + usage.sales * 8 + usage.clients * 2);
  const billingScore = outstanding <= 0
    ? 100
    : Math.max(20, 100 - share(outstanding, Math.max(monthlyRecurringRevenue, 1)));
  const readinessScore = pct((Number(Boolean(tenant.primaryDomain)) * 35) + Math.min(35, usage.branches * 12) + Math.min(30, usage.staff * 2));
  return {
    subscriptionScore: pct(subscriptionScore),
    usageScore: pct(usageScore),
    billingScore: pct(billingScore),
    readinessScore,
    overall: pct((subscriptionScore + usageScore + billingScore + readinessScore) / 4)
  };
}

function tenantRiskAlerts(tenant) {
  const alerts = [];
  const trialDaysLeft = daysUntil(tenant.trialEndsAt);
  if (tenant.subscriptionStatus === "suspended" || tenant.status === "suspended") {
    alerts.push({ severity: "high", type: "subscription", title: "Tenant suspended", message: "Reactivate only after billing and owner approval checks are clear." });
  }
  if (tenant.outstanding > 0) {
    alerts.push({
      severity: tenant.outstanding > tenant.monthlyRecurringRevenue ? "high" : "medium",
      type: "billing",
      title: "Outstanding billing",
      message: `Collect INR ${tenant.outstanding} before extending plan access.`
    });
  }
  if (trialDaysLeft !== null && trialDaysLeft >= 0 && trialDaysLeft <= 7) {
    alerts.push({ severity: "medium", type: "trial", title: "Trial ending soon", message: `${trialDaysLeft} days left to convert this tenant.` });
  }
  if (tenant.healthScore < 45) {
    alerts.push({ severity: "high", type: "health", title: "Low health score", message: "Usage, billing and setup health need immediate review." });
  } else if (tenant.healthScore < 70) {
    alerts.push({ severity: "medium", type: "health", title: "Health score watch", message: "Monitor adoption before this tenant becomes a churn risk." });
  }
  if (!tenant.primaryDomain) {
    alerts.push({ severity: "low", type: "readiness", title: "Domain not configured", message: "White-label readiness is incomplete for this salon." });
  }
  if (!tenant.usage.appointments || !tenant.usage.clients) {
    alerts.push({ severity: "medium", type: "adoption", title: "Low platform adoption", message: "Client or appointment activity is missing." });
  }
  return alerts;
}

function tenantActions(tenant) {
  const actions = [];
  if (tenant.outstanding > 0) actions.push("Collect outstanding billing balance");
  if (tenant.subscriptionStatus === "trialing") actions.push("Schedule trial conversion follow-up");
  if (tenant.subscriptionStatus === "suspended") actions.push("Review suspension reason before reactivation");
  if (!tenant.primaryDomain) actions.push("Complete domain and white-label setup");
  if (tenant.healthScore < 70) actions.push("Run adoption review for branches, staff and booking usage");
  return actions.length ? actions : ["Tenant is healthy; continue normal account monitoring"];
}

function tenant360(tenant) {
  const alerts = tenantRiskAlerts(tenant);
  return {
    profile: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      ownerEmail: tenant.ownerEmail,
      primaryDomain: tenant.primaryDomain,
      status: tenant.status,
      subscriptionStatus: tenant.subscriptionStatus,
      planName: tenant.planName,
      trialEndsAt: tenant.trialEndsAt,
      trialDaysLeft: daysUntil(tenant.trialEndsAt)
    },
    billing: {
      monthlyRecurringRevenue: tenant.monthlyRecurringRevenue,
      meteredUsageRevenue: tenant.meteredUsageRevenue,
      totalBillingAmount: tenant.totalBillingAmount,
      transactionRevenue: tenant.transactionRevenue,
      outstanding: tenant.outstanding
    },
    usage: tenant.usage,
    health: tenant.healthBreakdown,
    alerts,
    alertSummary: {
      total: alerts.length,
      high: alerts.filter((alert) => alert.severity === "high").length,
      medium: alerts.filter((alert) => alert.severity === "medium").length,
      low: alerts.filter((alert) => alert.severity === "low").length
    },
    recommendedActions: tenantActions(tenant)
  };
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 100))));
}

function normalizeRules(rules = {}) {
  if (typeof rules === "string") {
    try {
      return JSON.parse(rules || "{}");
    } catch {
      return {};
    }
  }
  return rules && typeof rules === "object" ? rules : {};
}

function enrichFeatureToggle(toggle, tenants, plans) {
  const rules = normalizeRules(toggle.rules);
  const rolloutPercentage = clampPercent(rules.rolloutPercentage);
  const expiresAt = rules.expiresAt || "";
  const killSwitch = Boolean(rules.killSwitch);
  const isExpired = expiresAt ? String(expiresAt).slice(0, 10) < now().slice(0, 10) : false;
  const targetTenant = toggle.tenantId ? tenants.find((tenant) => tenant.id === toggle.tenantId) : null;
  const targetPlan = toggle.planId ? plans.find((plan) => plan.id === toggle.planId) : null;
  const targetSummary = targetTenant?.name || targetPlan?.name || (toggle.scope === "global" ? "All tenants" : toggle.scope);
  const guardrails = [];
  if (killSwitch) guardrails.push("Kill switch armed");
  if (isExpired) guardrails.push("Expired");
  if (rolloutPercentage < 100) guardrails.push(`${rolloutPercentage}% rollout`);
  if (rules.dependencyKey) guardrails.push(`Depends on ${rules.dependencyKey}`);
  const statusLabel = killSwitch
    ? "killed"
    : !toggle.enabled
      ? "disabled"
      : isExpired
        ? "expired"
        : rolloutPercentage < 100
          ? "partial"
          : "enabled";
  return {
    ...toggle,
    baseKey: baseFeatureKey({ ...toggle, rules }),
    rules: { ...rules, rolloutPercentage, expiresAt, killSwitch },
    rolloutPercentage,
    expiresAt,
    killSwitch,
    dependencyKey: rules.dependencyKey || "",
    targetSummary,
    isExpired,
    statusLabel,
    guardrails
  };
}

function featureFlagCommand(featureToggles) {
  return {
    total: featureToggles.length,
    enabled: featureToggles.filter((toggle) => toggle.statusLabel === "enabled" || toggle.statusLabel === "partial").length,
    partialRollouts: featureToggles.filter((toggle) => toggle.rolloutPercentage < 100 && !toggle.killSwitch).length,
    killSwitches: featureToggles.filter((toggle) => toggle.killSwitch).length,
    expired: featureToggles.filter((toggle) => toggle.isExpired).length,
    tenantScoped: featureToggles.filter((toggle) => toggle.scope === "tenant").length,
    planScoped: featureToggles.filter((toggle) => toggle.scope === "plan").length,
    attention: featureToggles
      .filter((toggle) => toggle.killSwitch || toggle.isExpired || !toggle.enabled)
      .slice(0, 6)
      .map((toggle) => ({
        id: toggle.id,
        key: toggle.key,
        name: toggle.name,
        statusLabel: toggle.statusLabel,
        targetSummary: toggle.targetSummary,
        guardrails: toggle.guardrails
      }))
  };
}

function requireSafetyConfirmation(payload = {}, action = "action") {
  const reason = String(payload.reason || "").trim();
  const confirmation = String(payload.confirmation || "").trim();
  if (reason.length < 8) throw badRequest(`Safety reason is required for ${action}`);
  if (confirmation !== "CONFIRM") throw badRequest(`Type CONFIRM to approve ${action}`);
  return { reason, confirmation };
}

function actionSafetyCommand(tenantRows, featureToggles) {
  const auditRows = repositories.superAdminAudit.list({ limit: 200 }).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const resolvedIds = new Set(
    auditRows
      .filter((row) => row.action === "super_admin.action_approval.resolved")
      .map((row) => normalizeRules(row.details).requestId)
      .filter(Boolean)
  );
  const pendingApprovals = auditRows
    .filter((row) => row.action === "super_admin.action_approval.requested" && !resolvedIds.has(row.id))
    .map((row) => {
      const details = normalizeRules(row.details);
      return {
        id: row.id,
        action: details.action || row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: details.reason || "",
        priority: details.priority || "medium",
        requestedBy: row.actorUserId,
        createdAt: row.createdAt
      };
    });
  const requiredReviews = [
    ...tenantRows
      .filter((tenant) => tenant.subscriptionStatus === "suspended" || tenant.status === "suspended")
      .slice(0, 6)
      .map((tenant) => ({
        targetType: "tenant",
        targetId: tenant.id,
        name: tenant.name,
        action: "reactivation.review",
        severity: "high",
        reason: "Tenant is suspended; require reason and confirmation before reactivation."
      })),
    ...featureToggles
      .filter((toggle) => toggle.killSwitch)
      .slice(0, 6)
      .map((toggle) => ({
        targetType: "feature_toggle",
        targetId: toggle.id,
        name: toggle.name,
        action: "kill_switch.review",
        severity: "high",
        reason: "Kill switch is armed; review before enabling or rollout changes."
      }))
  ];
  return {
    pendingApprovals,
    requiredReviews,
    timeline: auditRows.slice(0, 50).map((row) => {
      const details = normalizeRules(row.details);
      return {
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        actorUserId: row.actorUserId,
        createdAt: row.createdAt,
        reason: details.reason || "",
        status: details.status || "",
        summary: details.key || details.action || details.status || details.reason || ""
      };
    }),
    stats: {
      pending: pendingApprovals.length,
      requiredReviews: requiredReviews.length,
      recentActions: auditRows.length
    }
  };
}

function avg(items, selector) {
  return items.length ? pct(sumRows(items, selector) / items.length) : 0;
}

function saasHealthEngine(metrics, tenantRows, featureToggles) {
  const activeTenants = tenantRows.filter((tenant) => ["active", "trialing"].includes(tenant.subscriptionStatus));
  const criticalTenants = tenantRows.filter((tenant) => tenant.healthScore < 45 || tenant.tenant360.alertSummary.high > 0);
  const watchTenants = tenantRows.filter((tenant) => tenant.healthScore >= 45 && tenant.healthScore < 75 && tenant.tenant360.alertSummary.high === 0);
  const healthyTenants = tenantRows.filter((tenant) => tenant.healthScore >= 75 && tenant.tenant360.alertSummary.high === 0);
  const billingQuality = share(metrics.monthlyRecurringRevenue, metrics.monthlyRecurringRevenue + metrics.outstanding);
  const adoptionScore = avg(activeTenants, (tenant) => tenant.healthBreakdown.usageScore);
  const setupReadiness = avg(activeTenants, (tenant) => tenant.healthBreakdown.readinessScore);
  const subscriptionHealth = avg(activeTenants, (tenant) => tenant.healthBreakdown.subscriptionScore);
  const riskPenalty = tenantRows.length ? Math.min(35, (criticalTenants.length / tenantRows.length) * 35) : 0;
  const killSwitchPenalty = Math.min(15, featureToggles.filter((toggle) => toggle.killSwitch).length * 5);
  const platformScore = pct(Math.max(0, (
    avg(activeTenants, (tenant) => tenant.healthScore) * 0.3
    + billingQuality * 0.25
    + adoptionScore * 0.2
    + setupReadiness * 0.15
    + subscriptionHealth * 0.1
  ) - riskPenalty - killSwitchPenalty));
  const signals = [
    {
      key: "billing",
      label: "Billing health",
      score: billingQuality,
      status: billingQuality >= 80 ? "healthy" : billingQuality >= 60 ? "watch" : "critical",
      detail: `INR ${metrics.outstanding} outstanding across tenants`
    },
    {
      key: "adoption",
      label: "Adoption health",
      score: adoptionScore,
      status: adoptionScore >= 75 ? "healthy" : adoptionScore >= 45 ? "watch" : "critical",
      detail: "Client, appointment, campaign and sales usage"
    },
    {
      key: "setup",
      label: "Setup readiness",
      score: setupReadiness,
      status: setupReadiness >= 75 ? "healthy" : setupReadiness >= 45 ? "watch" : "critical",
      detail: "Branches, staff and primary domain readiness"
    },
    {
      key: "control",
      label: "Control health",
      score: pct(Math.max(0, 100 - riskPenalty - killSwitchPenalty)),
      status: criticalTenants.length || killSwitchPenalty ? "watch" : "healthy",
      detail: `${criticalTenants.length} critical tenants and ${featureToggles.filter((toggle) => toggle.killSwitch).length} kill switches`
    }
  ];
  const watchlist = tenantRows
    .slice()
    .sort((a, b) => a.healthScore - b.healthScore || b.outstanding - a.outstanding)
    .slice(0, 8)
    .map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      planName: tenant.planName,
      healthScore: tenant.healthScore,
      subscriptionStatus: tenant.subscriptionStatus,
      outstanding: tenant.outstanding,
      topAlert: tenant.tenant360.alerts[0] || null,
      nextAction: tenant.tenant360.recommendedActions[0] || "Monitor account"
    }));
  const playbooks = [];
  if (metrics.outstanding > 0) playbooks.push({ title: "Billing recovery", detail: "Prioritize tenants with outstanding invoices before plan expansion." });
  if (watchTenants.length || criticalTenants.length) playbooks.push({ title: "Adoption rescue", detail: "Review low-usage tenants through Tenant 360 and schedule onboarding help." });
  if (featureToggles.some((toggle) => toggle.killSwitch)) playbooks.push({ title: "Kill-switch review", detail: "Resolve armed kill switches before widening feature rollout." });
  if (!playbooks.length) playbooks.push({ title: "Scale monitoring", detail: "SaaS base is stable; continue weekly health review." });
  return {
    platformScore,
    grade: platformScore >= 85 ? "A" : platformScore >= 70 ? "B" : platformScore >= 55 ? "C" : "D",
    segments: {
      healthy: healthyTenants.length,
      watch: watchTenants.length,
      critical: criticalTenants.length,
      suspended: tenantRows.filter((tenant) => tenant.subscriptionStatus === "suspended" || tenant.status === "suspended").length,
      trialing: tenantRows.filter((tenant) => tenant.subscriptionStatus === "trialing").length
    },
    signals,
    watchlist,
    playbooks
  };
}

function realtimeHealthAlerts(tenantRows) {
  return tenantRows
    .flatMap((tenant) => {
      const alerts = [];
      if (tenant.healthScore < 45) {
        alerts.push({
          id: `${tenant.id}:critical-health`,
          tenantId: tenant.id,
          tenantName: tenant.name,
          severity: "critical",
          type: "health",
          title: "Critical tenant health",
          message: `${tenant.name} health score is ${tenant.healthScore}.`,
          createdAt: now()
        });
      }
      if (tenant.outstanding > 0) {
        alerts.push({
          id: `${tenant.id}:billing-risk`,
          tenantId: tenant.id,
          tenantName: tenant.name,
          severity: tenant.outstanding > tenant.monthlyRecurringRevenue ? "critical" : "warning",
          type: "billing",
          title: "Outstanding billing risk",
          message: `${tenant.name} has INR ${tenant.outstanding} outstanding.`,
          createdAt: now()
        });
      }
      if (tenant.subscriptionStatus === "suspended" || tenant.status === "suspended") {
        alerts.push({
          id: `${tenant.id}:suspended`,
          tenantId: tenant.id,
          tenantName: tenant.name,
          severity: "critical",
          type: "subscription",
          title: "Tenant suspended",
          message: `${tenant.name} is suspended and needs account review.`,
          createdAt: now()
        });
      }
      return alerts;
    })
    .sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1))
    .slice(0, 30);
}

function lowUsageTenant(tenant) {
  return Number(tenant.usage?.appointments || 0) < 5 && Number(tenant.usage?.clients || 0) < 10;
}

function planDaysLeft(tenant) {
  return daysUntil(tenant.subscription?.currentPeriodEnd || tenant.trialEndsAt || "");
}

function invoicePaymentStatus(invoice = {}) {
  return String(invoice.payment_status || invoice.paymentStatus || invoice.status || "").toLowerCase();
}

function invoiceBalance(invoice = {}) {
  return Number(invoice.balance ?? invoice.due_amount ?? invoice.dueAmount ?? 0);
}

function tenantBillingOps(tenant, tenantInvoices, tenantPayments) {
  const failedInvoices = tenantInvoices.filter((invoice) => /failed|declined|bounced|rejected/.test(invoicePaymentStatus(invoice)));
  const failedPayments = tenantPayments.filter((payment) => /failed|declined|bounced|rejected/.test(String(payment.status || payment.payment_status || "").toLowerCase()));
  const unpaidInvoices = tenantInvoices.filter((invoice) => invoicePaymentStatus(invoice) !== "paid" && invoiceBalance(invoice) > 0);
  const pausedSubscription = ["paused", "pause", "past_due"].includes(String(tenant.subscriptionStatus || "").toLowerCase())
    || ["paused", "pause", "past_due"].includes(String(tenant.subscription?.status || "").toLowerCase());
  const failedPaymentCount = failedInvoices.length + failedPayments.length;
  const outstanding = money(sumRows(unpaidInvoices, invoiceBalance));
  const dunningSeverity = failedPaymentCount >= 3 || outstanding > tenant.monthlyRecurringRevenue
    ? "critical"
    : failedPaymentCount || outstanding || pausedSubscription
      ? "warning"
      : "healthy";
  const dunningStatus = dunningSeverity === "critical"
    ? "Escalate"
    : dunningSeverity === "warning"
      ? "Active"
      : "Clear";
  return {
    failedPaymentCount,
    failedPaymentAmount: money(sumRows(failedInvoices, (invoice) => invoiceBalance(invoice) || Number(invoice.total || invoice.grand_total || 0))),
    unpaidInvoiceCount: unpaidInvoices.length,
    outstanding,
    pausedSubscription,
    dunningStatus,
    dunningSeverity,
    nextAction: dunningSeverity === "critical"
      ? "Owner escalation"
      : pausedSubscription
        ? "Resume subscription"
        : failedPaymentCount
          ? "Retry payment"
          : outstanding
            ? "Send dunning reminder"
            : "No action"
  };
}

function healthFlagFor(tenant, threshold = 70) {
  if (tenant.subscriptionStatus === "suspended" || tenant.status === "suspended") {
    return { label: "Suspended", severity: "critical", threshold, reason: "Subscription suspended" };
  }
  const daysLeft = planDaysLeft(tenant);
  if (lowUsageTenant(tenant) && daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return { label: "Churn Risk", severity: "critical", threshold, reason: `Low usage + plan expires in ${daysLeft} days` };
  }
  if (tenant.healthScore < 45) {
    return { label: "Critical", severity: "critical", threshold, reason: `Health below 45` };
  }
  if (tenant.healthScore < threshold) {
    return { label: "Watch", severity: "warning", threshold, reason: `Health below ${threshold}` };
  }
  return { label: "Healthy", severity: "healthy", threshold, reason: "Above threshold" };
}

function revenueIntelligence(metrics, tenantRows, plans) {
  const topByMrr = tenantRows.slice().sort((a, b) => b.monthlyRecurringRevenue - a.monthlyRecurringRevenue);
  const topThreeMrr = money(sumRows(topByMrr.slice(0, 3), (tenant) => tenant.monthlyRecurringRevenue));
  const expansionCandidates = tenantRows
    .filter((tenant) => tenant.healthScore >= 70 && tenant.subscriptionStatus === "active")
    .sort((a, b) => b.usage.clients + b.usage.appointments - (a.usage.clients + a.usage.appointments))
    .slice(0, 6)
    .map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      planName: tenant.planName,
      healthScore: tenant.healthScore,
      signal: `${tenant.usage.clients} clients and ${tenant.usage.appointments} appointments`,
      estimatedUpsell: money(Math.max(0, tenant.monthlyRecurringRevenue * 0.35))
    }));
  const churnRisks = tenantRows
    .filter((tenant) => tenant.healthScore < 70 || tenant.outstanding > 0 || tenant.subscriptionStatus === "suspended")
    .sort((a, b) => b.monthlyRecurringRevenue + b.outstanding - (a.monthlyRecurringRevenue + a.outstanding))
    .slice(0, 6)
    .map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      planName: tenant.planName,
      healthScore: tenant.healthScore,
      mrrAtRisk: tenant.monthlyRecurringRevenue,
      outstanding: tenant.outstanding,
      reason: tenant.subscriptionStatus === "suspended"
        ? "Suspended account"
        : tenant.outstanding > 0
          ? "Outstanding billing"
          : "Low health score"
    }));
  const planOpportunities = plans.map((plan) => {
    const tenants = tenantRows.filter((tenant) => tenant.planId === plan.id);
    return {
      planId: plan.id,
      name: plan.name,
      tenants: tenants.length,
      mrr: money(sumRows(tenants, (tenant) => tenant.monthlyRecurringRevenue)),
      atRisk: tenants.filter((tenant) => tenant.healthScore < 70 || tenant.outstanding > 0).length,
      averageHealth: avg(tenants, (tenant) => tenant.healthScore)
    };
  }).sort((a, b) => b.mrr - a.mrr);
  return {
    concentrationRiskPct: share(topThreeMrr, metrics.monthlyRecurringRevenue),
    topThreeMrr,
    netRevenueExposure: money(metrics.outstanding + sumRows(churnRisks, (tenant) => tenant.mrrAtRisk)),
    expansionPipeline: money(sumRows(expansionCandidates, (tenant) => tenant.estimatedUpsell)),
    collectionPriority: money(metrics.outstanding),
    expansionCandidates,
    churnRisks,
    planOpportunities
  };
}

function revenueLeakageReport(metrics, tenantRows, featureToggles) {
  const suspendedTenants = tenantRows.filter((tenant) => tenant.subscriptionStatus === "suspended" || tenant.status === "suspended");
  const expiredTrialTenants = tenantRows.filter((tenant) => tenant.subscriptionStatus === "trialing" && daysUntil(tenant.trialEndsAt) !== null && daysUntil(tenant.trialEndsAt) < 0);
  const lowAdoptionTenants = tenantRows.filter((tenant) => ["active", "trialing"].includes(tenant.subscriptionStatus) && lowUsageTenant(tenant));
  const lowUsageExpiringTenants = tenantRows.filter((tenant) => {
    const daysLeft = planDaysLeft(tenant);
    return lowUsageTenant(tenant) && daysLeft !== null && daysLeft >= 0 && daysLeft <= 14;
  });
  const partialRollouts = featureToggles.filter((toggle) => toggle.enabled && !toggle.killSwitch && Number(toggle.rolloutPercentage || 0) > 0 && Number(toggle.rolloutPercentage || 0) < 100);
  const outstandingBilling = money(metrics.outstanding);
  const suspendedMrr = money(sumRows(suspendedTenants, (tenant) => tenant.monthlyRecurringRevenue));
  const expiredTrialPipeline = money(sumRows(expiredTrialTenants, (tenant) => tenant.monthlyRecurringRevenue));
  const lowAdoptionMrr = money(sumRows(lowAdoptionTenants, (tenant) => tenant.monthlyRecurringRevenue));
  const partialRolloutExposure = partialRollouts.length ? money(metrics.monthlyRecurringRevenue * 0.1) : 0;
  const lineItems = [
    {
      key: "outstanding",
      label: "Outstanding billing",
      amount: outstandingBilling,
      severity: outstandingBilling > 0 ? "critical" : "healthy",
      detail: `${tenantRows.filter((tenant) => tenant.outstanding > 0).length} tenants have unpaid invoices`,
      action: "Run billing recovery"
    },
    {
      key: "suspended",
      label: "Suspended MRR",
      amount: suspendedMrr,
      severity: suspendedMrr > 0 ? "critical" : "healthy",
      detail: `${suspendedTenants.length} suspended tenants still carry MRR`,
      action: "Reactivate or close revenue"
    },
    {
      key: "expired-trials",
      label: "Expired trial pipeline",
      amount: expiredTrialPipeline,
      severity: expiredTrialPipeline > 0 ? "warning" : "healthy",
      detail: `${expiredTrialTenants.length} trials are past expiry`,
      action: "Convert or archive trials"
    },
    {
      key: "low-adoption",
      label: "Low adoption MRR",
      amount: lowAdoptionMrr,
      severity: lowUsageExpiringTenants.length ? "critical" : lowAdoptionMrr > 0 ? "warning" : "healthy",
      detail: `${lowUsageExpiringTenants.length} low-usage tenants expire in 14 days`,
      action: "Start adoption rescue"
    },
    {
      key: "partial-rollout",
      label: "Partial rollout exposure",
      amount: partialRolloutExposure,
      severity: partialRolloutExposure > 0 ? "warning" : "healthy",
      detail: `${partialRollouts.length} paid features are not fully rolled out`,
      action: "Finish rollout or disable"
    }
  ];
  return {
    totalLeakage: money(sumRows(lineItems, (item) => item.amount)),
    outstandingBilling,
    suspendedMrr,
    expiredTrialPipeline,
    lowAdoptionMrr,
    partialRolloutExposure,
    lowUsageExpiringCount: lowUsageExpiringTenants.length,
    lineItems,
    atRiskTenants: lowUsageExpiringTenants
      .sort((a, b) => planDaysLeft(a) - planDaysLeft(b) || b.monthlyRecurringRevenue - a.monthlyRecurringRevenue)
      .slice(0, 8)
      .map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        planName: tenant.planName,
        daysLeft: planDaysLeft(tenant),
        healthScore: tenant.healthScore,
        mrrAtRisk: tenant.monthlyRecurringRevenue,
        usage: tenant.usage
      }))
  };
}

function billingOperationsReport(tenantRows) {
  const tenantsInDunning = tenantRows.filter((tenant) => tenant.billingOps?.dunningStatus !== "Clear");
  const failedPaymentTenants = tenantRows.filter((tenant) => tenant.billingOps?.failedPaymentCount > 0);
  const pausedTenants = tenantRows.filter((tenant) => tenant.billingOps?.pausedSubscription);
  return {
    failedPayments: sumRows(tenantRows, (tenant) => tenant.billingOps?.failedPaymentCount || 0),
    failedPaymentAmount: money(sumRows(tenantRows, (tenant) => tenant.billingOps?.failedPaymentAmount || 0)),
    pausedSubscriptions: pausedTenants.length,
    activeDunning: tenantsInDunning.length,
    criticalDunning: tenantsInDunning.filter((tenant) => tenant.billingOps?.dunningSeverity === "critical").length,
    dunningAmount: money(sumRows(tenantsInDunning, (tenant) => tenant.billingOps?.outstanding || 0)),
    tenants: tenantsInDunning
      .sort((a, b) => (b.billingOps.outstanding + b.billingOps.failedPaymentAmount) - (a.billingOps.outstanding + a.billingOps.failedPaymentAmount))
      .slice(0, 10)
      .map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        planName: tenant.planName,
        subscriptionStatus: tenant.subscriptionStatus,
        monthlyRecurringRevenue: tenant.monthlyRecurringRevenue,
        billingOps: tenant.billingOps
      })),
    pausedTenants: pausedTenants.slice(0, 8).map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      planName: tenant.planName,
      monthlyRecurringRevenue: tenant.monthlyRecurringRevenue,
      billingOps: tenant.billingOps
    })),
    failedPaymentTenants: failedPaymentTenants.slice(0, 8).map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      planName: tenant.planName,
      billingOps: tenant.billingOps
    }))
  };
}

function tenantFeatureOverrideMatrix(featureToggles, tenantRows) {
  const globalsByKey = new Map(featureToggles
    .filter((toggle) => toggle.scope === "global")
    .map((toggle) => [baseFeatureKey(toggle), toggle]));
  const overrides = featureToggles
    .filter((toggle) => toggle.scope === "tenant")
    .map((override) => {
      const key = baseFeatureKey(override);
      const global = globalsByKey.get(key) || null;
      const tenant = tenantRows.find((row) => row.id === override.tenantId);
      const globalEnabled = Boolean(global?.enabled) && !global?.killSwitch && !global?.isExpired;
      const tenantEnabled = Boolean(override.enabled) && !override.killSwitch && !override.isExpired;
      return {
        id: override.id,
        key,
        name: override.name,
        tenantId: override.tenantId,
        tenantName: tenant?.name || override.tenantId,
        globalToggleId: global?.id || "",
        globalEnabled,
        tenantEnabled,
        effectiveEnabled: tenantEnabled,
        precedence: tenantEnabled === globalEnabled ? "same" : tenantEnabled ? "tenant_on" : "tenant_off",
        rolloutPercentage: override.rolloutPercentage,
        statusLabel: override.statusLabel,
        targetSummary: override.targetSummary
      };
    });
  return {
    overrideCount: overrides.length,
    tenantOnOverGlobalOff: overrides.filter((item) => item.precedence === "tenant_on").length,
    tenantOffOverGlobalOn: overrides.filter((item) => item.precedence === "tenant_off").length,
    overrides: overrides
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName) || a.key.localeCompare(b.key))
      .slice(0, 20),
    globalFeatures: featureToggles
      .filter((toggle) => toggle.scope === "global")
      .map((toggle) => ({
        id: toggle.id,
        key: baseFeatureKey(toggle),
        name: toggle.name,
        enabled: Boolean(toggle.enabled) && !toggle.killSwitch && !toggle.isExpired,
        statusLabel: toggle.statusLabel
      }))
  };
}

function usageQuotaBillingAlerts(tenantRows) {
  const quotaAlerts = tenantRows.flatMap((tenant) => {
    const limits = tenant.tenantLimits || {};
    return ["branches", "staff", "clients"].map((metric) => {
      const used = Number(tenant.usage?.[metric] || 0);
      const limit = Number(limits[metric] || 0);
      const usagePct = share(used, Math.max(1, limit));
      if (usagePct < 80) return null;
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        ownerEmail: tenant.ownerEmail,
        metric,
        used,
        limit,
        usagePct,
        severity: usagePct >= 100 ? "critical" : usagePct >= 90 ? "warning" : "watch",
        action: usagePct >= 100 ? "Block or upsell quota" : "Send quota warning",
        supportTicketLink: `/support/tickets/new?tenantId=${encodeURIComponent(tenant.id)}&source=quota&metric=${encodeURIComponent(metric)}`
      };
    }).filter(Boolean);
  });
  const billingAlerts = tenantRows
    .filter((tenant) => tenant.billingOps?.dunningStatus !== "Clear" || tenant.outstanding > 0)
    .map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      outstanding: tenant.outstanding,
      dunningStatus: tenant.billingOps?.dunningStatus || "Clear",
      failedPayments: tenant.billingOps?.failedPaymentCount || 0,
      severity: tenant.billingOps?.dunningSeverity || (tenant.outstanding > 0 ? "warning" : "healthy"),
      action: tenant.billingOps?.nextAction || "Send billing alert",
      supportTicketLink: `/support/tickets/new?tenantId=${encodeURIComponent(tenant.id)}&source=billing`
    }));
  return {
    quotaAlertCount: quotaAlerts.length,
    billingAlertCount: billingAlerts.length,
    overLimitCount: quotaAlerts.filter((alert) => alert.severity === "critical").length,
    quotaAlerts: quotaAlerts
      .sort((a, b) => b.usagePct - a.usagePct)
      .slice(0, 20),
    billingAlerts: billingAlerts
      .sort((a, b) => b.outstanding - a.outstanding || b.failedPayments - a.failedPayments)
      .slice(0, 20)
  };
}

function quotaAlertEventKey(alert) {
  return `quota-cross:${alert.tenantId}:${alert.metric}:${now().slice(0, 10)}`;
}

function supportLinksForTenant(tenant = {}) {
  const tenantId = encodeURIComponent(tenant.id || "");
  const name = encodeURIComponent(tenant.name || "");
  const email = encodeURIComponent(tenant.ownerEmail || "");
  const domain = encodeURIComponent(tenant.primaryDomain || "");
  const subject = encodeURIComponent(`Support for ${tenant.name || tenant.id || "tenant"}`);
  return {
    internal: `/support/tickets/new?tenantId=${tenantId}&name=${name}&email=${email}&source=super-admin`,
    intercom: `https://app.intercom.com/a/inbox/search?query=${email || tenantId}`,
    zendesk: `https://aurasalon.zendesk.com/agent/tickets/new?ticket[subject]=${subject}&ticket[requester][email]=${email}&ticket[custom_fields][tenant_id]=${tenantId}&ticket[custom_fields][domain]=${domain}`
  };
}

function monthKey(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return now().slice(0, 7);
  return date.toISOString().slice(0, 7);
}

function recentMonthKeys(count = 6) {
  const date = new Date();
  return Array.from({ length: count }, (_, index) => {
    const item = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - (count - 1 - index), 1));
    return item.toISOString().slice(0, 7);
  });
}

function revenueGrowthGraph(tenantRows) {
  const months = recentMonthKeys(6);
  return months.map((month, index) => {
    const activeInMonth = tenantRows.filter((tenant) => {
      const createdMonth = monthKey(tenant.createdAt || tenant.subscription?.createdAt || tenant.subscription?.currentPeriodStart || "");
      return createdMonth <= month && tenant.subscriptionStatus !== "suspended";
    });
    const churnedInMonth = tenantRows.filter((tenant) => {
      const churnMonth = monthKey(tenant.subscription?.cancelAt || "");
      return tenant.subscriptionStatus === "suspended" && churnMonth === month;
    });
    const trialInMonth = tenantRows.filter((tenant) => tenant.subscriptionStatus === "trialing" && monthKey(tenant.createdAt || tenant.trialEndsAt || "") <= month);
    const mrr = money(sumRows(activeInMonth, (tenant) => tenant.monthlyRecurringRevenue));
    const previousMrr = index
      ? money(sumRows(tenantRows.filter((tenant) => {
          const createdMonth = monthKey(tenant.createdAt || tenant.subscription?.createdAt || tenant.subscription?.currentPeriodStart || "");
          return createdMonth <= months[index - 1] && tenant.subscriptionStatus !== "suspended";
        }), (tenant) => tenant.monthlyRecurringRevenue))
      : mrr;
    const churnedMrr = money(sumRows(churnedInMonth, (tenant) => tenant.monthlyRecurringRevenue));
    return {
      month,
      mrr,
      arr: money(mrr * 12),
      growth: money(mrr - previousMrr),
      churnedMrr,
      activeTenants: activeInMonth.length,
      trialTenants: trialInMonth.length
    };
  });
}

function revenueGrowthSummary(graph = []) {
  const latest = graph[graph.length - 1] || {};
  const previous = graph[graph.length - 2] || {};
  const bestGrowthMonth = graph
    .slice()
    .sort((a, b) => Number(b.growth || 0) - Number(a.growth || 0))[0] || {};
  const highestChurnMonth = graph
    .slice()
    .sort((a, b) => Number(b.churnedMrr || 0) - Number(a.churnedMrr || 0))[0] || {};
  const netGrowth = money(Number(latest.mrr || 0) - Number(previous.mrr || latest.mrr || 0));
  const totalChurnedMrr = money(sumRows(graph, (row) => row.churnedMrr));
  return {
    latestMonth: latest.month || "",
    latestMrr: money(latest.mrr || 0),
    latestArr: money(latest.arr || 0),
    netGrowth,
    momentum: netGrowth >= 0 ? "growing" : "contracting",
    churnRate: latest.mrr ? share(latest.churnedMrr, latest.mrr) : 0,
    totalChurnedMrr,
    bestGrowthMonth: bestGrowthMonth.month || "",
    bestGrowthAmount: money(bestGrowthMonth.growth || 0),
    highestChurnMonth: highestChurnMonth.month || "",
    highestChurnAmount: money(highestChurnMonth.churnedMrr || 0)
  };
}

function trialPaidFunnel(tenantRows) {
  const total = tenantRows.length;
  const trialing = tenantRows.filter((tenant) => tenant.subscriptionStatus === "trialing").length;
  const paidTenants = tenantRows.filter((tenant) => tenant.subscriptionStatus === "active");
  const paid = paidTenants.length;
  const suspended = tenantRows.filter((tenant) => tenant.subscriptionStatus === "suspended" || tenant.status === "suspended").length;
  const expiredTrial = tenantRows.filter((tenant) => tenant.subscriptionStatus === "trialing" && daysUntil(tenant.trialEndsAt) !== null && daysUntil(tenant.trialEndsAt) < 0).length;
  const conversionDays = paidTenants
    .map((tenant) => {
      const start = new Date(tenant.subscription?.trialStart || tenant.createdAt || tenant.subscription?.createdAt || "").getTime();
      const converted = new Date(tenant.subscription?.currentPeriodStart || tenant.subscription?.updatedAt || tenant.updatedAt || "").getTime();
      if (Number.isNaN(start) || Number.isNaN(converted) || converted < start) return null;
      return Math.ceil((converted - start) / 86400000);
    })
    .filter((value) => value !== null);
  return {
    stages: [
      { label: "All tenants", count: total, pct: 100 },
      { label: "Trialing", count: trialing, pct: share(trialing, total) },
      { label: "Paid active", count: paid, pct: share(paid, total) },
      { label: "Suspended/churn risk", count: suspended, pct: share(suspended, total) }
    ],
    conversionRate: share(paid, paid + trialing + suspended),
    convertedTrials: paid,
    averageConversionDays: conversionDays.length ? pct(sumRows(conversionDays, (value) => value) / conversionDays.length) : 0,
    trialLeakage: expiredTrial,
    paidMrr: money(sumRows(tenantRows.filter((tenant) => tenant.subscriptionStatus === "active"), (tenant) => tenant.monthlyRecurringRevenue)),
    trialPipelineMrr: money(sumRows(tenantRows.filter((tenant) => tenant.subscriptionStatus === "trialing"), (tenant) => tenant.monthlyRecurringRevenue))
  };
}

function churnPrediction(tenantRows) {
  const predictions = tenantRows.map((tenant) => {
    const healthRisk = Math.max(0, 70 - tenant.healthScore);
    const billingRisk = tenant.outstanding > tenant.monthlyRecurringRevenue ? 25 : tenant.outstanding > 0 ? 14 : 0;
    const suspensionRisk = tenant.subscriptionStatus === "suspended" || tenant.status === "suspended" ? 30 : 0;
    const adoptionRisk = (!tenant.usage.appointments || !tenant.usage.clients) ? 12 : tenant.usage.appointments < 5 ? 6 : 0;
    const trialRisk = tenant.subscriptionStatus === "trialing" && daysUntil(tenant.trialEndsAt) !== null && daysUntil(tenant.trialEndsAt) <= 7 ? 8 : 0;
    const churnScore = pct(Math.min(100, healthRisk + billingRisk + suspensionRisk + adoptionRisk + trialRisk));
    const drivers = [
      healthRisk ? "low health" : "",
      billingRisk ? "billing exposure" : "",
      suspensionRisk ? "suspended" : "",
      adoptionRisk ? "low adoption" : "",
      trialRisk ? "trial ending" : ""
    ].filter(Boolean);
    const probability = churnScore >= 70 ? "high" : churnScore >= 40 ? "medium" : "low";
    const recommendedAction = drivers.includes("billing exposure")
      ? "Run billing recovery"
      : drivers.includes("low adoption")
        ? "Schedule adoption rescue"
        : drivers.includes("trial ending")
          ? "Convert trial before expiry"
          : "Monitor account";
    const dueInDays = probability === "high" ? 1 : probability === "medium" ? 3 : 7;
    return {
      id: tenant.id,
      name: tenant.name,
      planName: tenant.planName,
      subscriptionStatus: tenant.subscriptionStatus,
      churnScore,
      probability,
      mrrAtRisk: tenant.monthlyRecurringRevenue,
      outstanding: tenant.outstanding,
      drivers,
      recommendedAction,
      dueInDays,
      ownerQueue: probability === "high" ? "customer_success_urgent" : probability === "medium" ? "customer_success_watch" : "account_monitoring",
      playbook: drivers.includes("billing exposure")
        ? ["Retry billing", "Open support ticket", "Confirm payment method"]
        : drivers.includes("low adoption")
          ? ["Book onboarding call", "Review usage blockers", "Send adoption checklist"]
          : drivers.includes("trial ending")
            ? ["Call decision maker", "Offer plan fit review", "Confirm conversion date"]
            : ["Monitor next login", "Review next billing cycle"],
      confidence: Math.min(95, Math.max(35, Math.round(churnScore + drivers.length * 8)))
    };
  });
  const atRisk = predictions.filter((item) => item.probability !== "low");
  return {
    highRiskCount: predictions.filter((item) => item.probability === "high").length,
    mediumRiskCount: predictions.filter((item) => item.probability === "medium").length,
    mrrAtRisk: money(sumRows(atRisk, (item) => item.mrrAtRisk)),
    urgentActions: atRisk
      .sort((a, b) => a.dueInDays - b.dueInDays || b.churnScore - a.churnScore)
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        name: item.name,
        probability: item.probability,
        recommendedAction: item.recommendedAction,
        dueInDays: item.dueInDays,
        ownerQueue: item.ownerQueue,
        mrrAtRisk: item.mrrAtRisk
      })),
    riskMix: {
      highMrr: money(sumRows(predictions.filter((item) => item.probability === "high"), (item) => item.mrrAtRisk)),
      mediumMrr: money(sumRows(predictions.filter((item) => item.probability === "medium"), (item) => item.mrrAtRisk)),
      lowMrr: money(sumRows(predictions.filter((item) => item.probability === "low"), (item) => item.mrrAtRisk))
    },
    tenants: predictions
      .filter((item) => item.churnScore > 0)
      .sort((a, b) => b.churnScore - a.churnScore)
      .slice(0, 10)
  };
}

function tenantAiRiskScore(tenant, auditRows = []) {
  const supportNotes = auditRows.filter((row) => row.targetType === "tenant" && row.targetId === tenant.id && ["tenant.support_note.added", "tenant.support_owner.assigned", "super_admin.action_inbox.updated"].includes(row.action));
  const loginDays = daysSince(tenant.drilldown?.lastLoginAt);
  const trialDaysLeft = daysUntil(tenant.trialEndsAt);
  const security = tenant.enterpriseSecurity || {};
  const securityGapCount = [
    security.enterpriseTenant && security.ipRestrictionStatus !== "enforced",
    security.enterpriseTenant && security.ssoStatus !== "enforced",
    tenant.dataExportControls?.status === "open",
    Number(tenant.drilldown?.loginActivityMap?.criticalLogins || 0) > 0
  ].filter(Boolean).length;
  const usageRisk = tenant.usage.appointments === 0 && tenant.usage.clients === 0
    ? 22
    : tenant.usage.appointments < 5
      ? 14
      : tenant.usage.appointments < 20
        ? 8
        : 0;
  const billingRisk = tenant.outstanding > tenant.monthlyRecurringRevenue
    ? 28
    : tenant.outstanding > 0 || Number(tenant.billingOps?.failedPaymentCount || 0) > 0
      ? 18
      : 0;
  const loginRisk = loginDays === null
    ? 12
    : loginDays > 30
      ? 18
      : loginDays > 14
        ? 10
        : 0;
  const healthRisk = Math.max(0, Math.round((70 - Number(tenant.healthScore || 0)) / 2));
  const churnRisk = tenant.subscriptionStatus === "suspended" || tenant.status === "suspended"
    ? 24
    : trialDaysLeft !== null && trialDaysLeft >= 0 && trialDaysLeft <= 7
      ? 12
      : 0;
  const supportRisk = supportNotes.length >= 5 ? 12 : supportNotes.length >= 2 ? 7 : 0;
  const securityRisk = securityGapCount * 8;
  const factors = [
    { key: "billing", label: "Billing exposure", score: billingRisk, detail: tenant.outstanding > 0 ? `INR ${tenant.outstanding} outstanding` : "No billing exposure" },
    { key: "usage", label: "Usage drop", score: usageRisk, detail: `${tenant.usage.appointments} bookings and ${tenant.usage.clients} clients` },
    { key: "login", label: "Login inactivity", score: loginRisk, detail: loginDays === null ? "No login seen" : `${loginDays} days since last login` },
    { key: "security", label: "Security gap", score: securityRisk, detail: `${securityGapCount} enterprise/security gap(s)` },
    { key: "support", label: "Support pressure", score: supportRisk, detail: `${supportNotes.length} recent support/audit signals` },
    { key: "churn", label: "Churn probability", score: churnRisk + healthRisk, detail: tenant.subscriptionStatus === "suspended" ? "Suspended tenant" : `Health ${tenant.healthScore}` }
  ];
  const score = pct(Math.min(100, sumRows(factors, (factor) => factor.score)));
  const label = score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "watch" : "stable";
  const primary = factors.slice().sort((a, b) => b.score - a.score)[0] || factors[0];
  const recommendedAction = primary.key === "billing"
    ? "Run payment recovery and owner follow-up"
    : primary.key === "usage"
      ? "Assign adoption rescue playbook"
      : primary.key === "login"
        ? "Contact owner and verify admin access"
        : primary.key === "security"
          ? "Close SSO/IP/export control gaps"
          : primary.key === "support"
            ? "Assign support owner and set SLA"
            : "Run churn prevention review";
  return {
    score,
    label,
    confidence: Math.min(96, Math.max(42, Math.round(score + factors.filter((factor) => factor.score > 0).length * 6))),
    primaryDriver: primary.label,
    ownerQueue: label === "critical" ? "customer_success_urgent" : label === "high" ? "customer_success_watch" : "account_monitoring",
    dueInDays: label === "critical" ? 1 : label === "high" ? 2 : label === "watch" ? 5 : 14,
    recommendedAction,
    factors
  };
}

function latestActionInboxEvents(auditRows = []) {
  const latest = new Map();
  for (const row of auditRows.filter((event) => event.action === "super_admin.action_inbox.updated")) {
    const details = normalizeRules(row.details);
    const itemId = details.itemId || row.targetId;
    if (!itemId || latest.has(itemId)) continue;
    latest.set(itemId, { ...details, auditId: row.id, actorUserId: row.actorUserId, createdAt: row.createdAt });
  }
  return latest;
}

function actionInboxForTenants(tenantRows = [], auditRows = []) {
  const latest = latestActionInboxEvents(auditRows);
  const items = [];
  for (const tenant of tenantRows) {
    const factors = tenant.aiRiskScore?.factors || [];
    for (const factor of factors.filter((item) => item.score > 0)) {
      const itemId = `inbox_${tenant.id}_${factor.key}`;
      const state = latest.get(itemId) || {};
      const status = state.status || "open";
      items.push({
        id: itemId,
        tenantId: tenant.id,
        tenantName: tenant.name,
        category: factor.key,
        priority: tenant.aiRiskScore.label,
        riskScore: tenant.aiRiskScore.score,
        title: `${factor.label}: ${tenant.name}`,
        detail: factor.detail,
        recommendedAction: tenant.aiRiskScore.recommendedAction,
        ownerQueue: state.ownerQueue || tenant.aiRiskScore.ownerQueue,
        status,
        dueInDays: state.dueInDays ?? tenant.aiRiskScore.dueInDays,
        note: state.note || "",
        updatedAt: state.createdAt || ""
      });
    }
  }
  const activeItems = items
    .sort((a, b) => b.riskScore - a.riskScore || a.dueInDays - b.dueInDays)
    .slice(0, 60);
  return {
    summary: {
      open: activeItems.filter((item) => item.status === "open").length,
      snoozed: activeItems.filter((item) => item.status === "snoozed").length,
      escalated: activeItems.filter((item) => item.status === "escalated").length,
      critical: activeItems.filter((item) => item.priority === "critical").length,
      dueToday: activeItems.filter((item) => Number(item.dueInDays || 0) <= 1).length
    },
    items: activeItems
  };
}

function riskTimelineForTenant(tenant, auditRows = []) {
  const current = Number(tenant.aiRiskScore?.score || tenant.healthScore || 0);
  const driverWeight = {
    "tenant.support_note.added": 5,
    "tenant.support_owner.assigned": -3,
    "super_admin.action_inbox.updated": -4,
    "tenant.gdpr_export.initiated": 4,
    "tenant.bulk_action.executed": 3,
    "tenant.suspended": 18,
    "tenant.reactivated": -12,
    "tenant.subscription.updated": -4,
    "tenant.sso.updated": -6,
    "tenant.ip_allowlist.updated": -6,
    "tenant.data_export_controls.updated": -5
  };
  const relevant = auditRows
    .filter((row) => row.targetId === tenant.id || normalizeRules(row.details).tenantId === tenant.id)
    .slice(0, 40);
  return Array.from({ length: 7 }).map((_, index) => {
    const daysAgo = 6 - index;
    const day = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    const dayEvents = relevant.filter((row) => String(row.createdAt || "").slice(0, 10) === day);
    const adjustment = dayEvents.reduce((total, event) => total + Number(driverWeight[event.action] || 0), 0);
    const drift = (6 - index) * 2;
    const score = Math.max(0, Math.min(100, Math.round(current - drift + adjustment)));
    return {
      day,
      score,
      events: dayEvents.length,
      label: score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "watch" : "stable"
    };
  });
}

function operationsPlaybooks(tenantRows = [], actionInbox = {}) {
  const items = actionInbox.items || [];
  const countByCategory = (category) => items.filter((item) => item.category === category).length;
  return [
    {
      key: "billing_recovery",
      title: "Billing recovery",
      category: "billing",
      count: countByCategory("billing"),
      ownerQueue: "finance_recovery",
      actions: ["Retry failed payments", "Send owner payment link", "Escalate unpaid MRR"]
    },
    {
      key: "adoption_rescue",
      title: "Adoption rescue",
      category: "usage",
      count: countByCategory("usage"),
      ownerQueue: "customer_success_watch",
      actions: ["Book onboarding call", "Review branch/staff setup", "Send usage checklist"]
    },
    {
      key: "trial_conversion",
      title: "Trial conversion",
      category: "churn",
      count: tenantRows.filter((tenant) => tenant.subscriptionStatus === "trialing" && daysUntil(tenant.trialEndsAt) !== null && daysUntil(tenant.trialEndsAt) <= 7).length,
      ownerQueue: "sales_conversion",
      actions: ["Call decision maker", "Recommend plan fit", "Confirm conversion date"]
    },
    {
      key: "security_hardening",
      title: "Security hardening",
      category: "security",
      count: countByCategory("security") + countByCategory("login"),
      ownerQueue: "security_success",
      actions: ["Enforce SSO", "Review IP allowlist", "Close export control gaps"]
    },
    {
      key: "churn_prevention",
      title: "Churn prevention",
      category: "churn",
      count: tenantRows.filter((tenant) => Number(tenant.aiRiskScore?.score || 0) >= 55).length,
      ownerQueue: "customer_success_urgent",
      actions: ["Assign owner", "Set SLA", "Run retention review"]
    }
  ];
}

function commandCenterNotifications(auditRows = [], actionInbox = {}, pendingApprovals = []) {
  const notificationActions = new Set([
    "super_admin.action_inbox.updated",
    "super_admin.action_approval.requested",
    "super_admin.action_approval.resolved",
    "tenant.gdpr_export.initiated",
    "tenant.support_owner.assigned",
    "tenant.bulk_action.executed",
    "tenant.quota_alert.batch_dispatched"
  ]);
  const notifications = auditRows
    .filter((row) => notificationActions.has(row.action))
    .slice(0, 30)
    .map((row) => {
      const details = normalizeRules(row.details);
      const severity = row.action.includes("approval") || details.status === "escalated"
        ? "warning"
        : row.action.includes("gdpr") || row.action.includes("bulk")
          ? "critical"
          : "info";
      return {
        id: row.id,
        title: row.action.replaceAll("_", " "),
        detail: details.reason || details.note || details.supportOwner || details.status || details.action || "Recorded",
        targetId: row.targetId,
        severity,
        createdAt: row.createdAt
      };
    });
  const breached = (actionInbox.items || []).filter((item) => Number(item.dueInDays || 0) <= 0 && item.status !== "resolved");
  return {
    summary: {
      notifications: notifications.length,
      pendingApprovals: pendingApprovals.length,
      slaBreaches: breached.length,
      escalated: (actionInbox.items || []).filter((item) => item.status === "escalated").length
    },
    notifications,
    slaBreaches: breached.slice(0, 10)
  };
}

function securityRiskCenter(tenantRows = [], auditRows = []) {
  const sensitiveActions = auditRows.filter((row) => [
    "tenant.impersonation.started",
    "tenant.gdpr_export.initiated",
    "tenant.sso.updated",
    "tenant.ip_allowlist.updated",
    "tenant.data_export_controls.updated"
  ].includes(row.action));
  const incidents = [];
  for (const tenant of tenantRows) {
    const map = tenant.drilldown?.loginActivityMap || {};
    const enterprise = tenant.enterpriseSecurity || {};
    const suspiciousLogins = Number(map.suspiciousLogins || 0);
    const criticalLogins = Number(map.criticalLogins || 0);
    if (criticalLogins || suspiciousLogins) {
      incidents.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        severity: criticalLogins ? "critical" : "warning",
        signal: "suspicious_login",
        summary: `${suspiciousLogins} suspicious and ${criticalLogins} critical login signals`,
        action: criticalLogins ? "Require session review and 2FA verification" : "Review device/IP activity"
      });
    }
    if (enterprise.enterpriseTenant && enterprise.ipRestrictionStatus !== "enforced") {
      incidents.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        severity: "warning",
        signal: "ip_gap",
        summary: `Enterprise IP restriction is ${enterprise.ipRestrictionStatus || "missing"}`,
        action: "Enforce IP allowlist or document exception"
      });
    }
    if (enterprise.enterpriseTenant && !["active", "enforced", "ready"].includes(enterprise.ssoStatus || "")) {
      incidents.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        severity: "warning",
        signal: "sso_gap",
        summary: `SSO status is ${enterprise.ssoStatus || "not_configured"}`,
        action: "Complete SSO/SAML setup"
      });
    }
    if (enterprise.enterpriseTenant && enterprise.dataExportStatus !== "restricted") {
      incidents.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        severity: "warning",
        signal: "export_gap",
        summary: `Data export controls are ${enterprise.dataExportStatus || "open"}`,
        action: "Require approval and PII masking"
      });
    }
  }
  return {
    metrics: {
      suspiciousLogins: sumRows(tenantRows, (tenant) => tenant.drilldown?.loginActivityMap?.suspiciousLogins || 0),
      criticalLogins: sumRows(tenantRows, (tenant) => tenant.drilldown?.loginActivityMap?.criticalLogins || 0),
      ipGaps: tenantRows.filter((tenant) => tenant.enterpriseSecurity?.enterpriseTenant && tenant.enterpriseSecurity?.ipRestrictionStatus !== "enforced").length,
      ssoGaps: tenantRows.filter((tenant) => tenant.enterpriseSecurity?.enterpriseTenant && !["active", "enforced", "ready"].includes(tenant.enterpriseSecurity?.ssoStatus || "")).length,
      exportGaps: tenantRows.filter((tenant) => tenant.enterpriseSecurity?.enterpriseTenant && tenant.enterpriseSecurity?.dataExportStatus !== "restricted").length,
      sensitiveActions: sensitiveActions.length
    },
    sensitiveActions: sensitiveActions.slice(0, 8).map((row) => {
      const details = normalizeRules(row.details);
      return {
        id: row.id,
        action: row.action,
        tenantId: row.targetId,
        actorUserId: row.actorUserId,
        createdAt: row.createdAt,
        summary: details.reason || details.status || "Recorded"
      };
    }),
    incidents: incidents
      .sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1))
      .slice(0, 12)
  };
}

function tenantDrilldown(tenant, tenantInvoices, tenantUsers, auditRows, trustedDevices = [], riskEvents = [], privacyRequests = []) {
  const lastLoginAt = tenantUsers
    .map((user) => user.lastLoginAt || "")
    .filter(Boolean)
    .sort()
    .pop() || "";
  const supportNotes = auditRows
    .filter((row) => row.targetType === "tenant" && row.targetId === tenant.id && ["tenant.support_note.added", "tenant.support_owner.assigned"].includes(row.action))
    .slice(0, 8)
    .map((row) => {
      const details = normalizeRules(row.details);
      const assignedOwner = row.action === "tenant.support_owner.assigned" ? `Assigned support owner: ${details.supportOwner || details.queue || "customer_success"}` : "";
      return {
        id: row.id,
        note: details.note || assignedOwner || details.reason || "",
        author: row.actorUserId,
        createdAt: row.createdAt
      };
    });
  const auditLog = auditRows
    .filter((row) => row.targetType === "tenant" && row.targetId === tenant.id)
    .slice(0, 12)
    .map((row) => {
      const details = normalizeRules(row.details);
      return {
        id: row.id,
        action: row.action,
        actorUserId: row.actorUserId,
        createdAt: row.createdAt,
        summary: details.note || details.supportOwner || details.reason || details.status || details.planId || details.key || ""
      };
    });
  const gdprExportRequests = privacyRequests
    .filter((row) => row.requestType === "gdpr_full_export")
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      status: row.status,
      requesterId: row.requesterId,
      summary: row.summary,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  const recentUsers = tenantUsers
    .slice()
    .sort((a, b) => String(b.lastLoginAt || b.updatedAt || "").localeCompare(String(a.lastLoginAt || a.updatedAt || "")))
    .slice(0, 8)
    .map((user) => ({
      id: user.id,
      name: user.name || user.email || user.id,
      email: user.email || "",
      role: user.role || "",
      status: user.status || "",
      branchIds: parseBranchIds(user.branchIds),
      failedLoginCount: Number(user.failedLoginCount || 0),
      lastLoginAt: user.lastLoginAt || ""
    }));
  return {
    usageGraph: [
      { label: "Branches", value: tenant.usage.branches },
      { label: "Staff", value: tenant.usage.staff },
      { label: "Clients", value: tenant.usage.clients },
      { label: "Appointments", value: tenant.usage.appointments },
      { label: "Sales", value: tenant.usage.sales },
      { label: "Campaigns", value: tenant.usage.campaigns }
    ],
    invoiceSummary: {
      total: tenantInvoices.length,
      paid: tenantInvoices.filter((invoice) => invoice.status === "paid").length,
      unpaid: tenantInvoices.filter((invoice) => invoice.status !== "paid").length,
      outstanding: tenant.outstanding
    },
    recentInvoices: tenantInvoices
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 8)
      .map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber || invoice.invoice_no || invoice.id,
        status: invoice.status || invoice.payment_status || "",
        total: Number(invoice.total || invoice.grand_total || 0),
        paid: Number(invoice.paid || invoice.paid_amount || 0),
        balance: Number(invoice.balance || invoice.due_amount || 0),
        createdAt: invoice.createdAt || invoice.created_at || ""
      })),
    staffCount: tenant.usage.staff,
    tenantUserCount: tenantUsers.length,
    lastLoginAt,
    recentUsers,
    loginActivityMap: loginActivityMap(tenantUsers, trustedDevices, riskEvents),
    gdprExportRequests,
    supportNotes,
    auditLog
  };
}

function revenueCommand(metrics, tenants, plans) {
  const activeTenants = tenants.filter((tenant) => ["active", "trialing"].includes(tenant.subscriptionStatus));
  const planMix = plans.map((plan) => {
    const planTenants = tenants.filter((tenant) => tenant.planId === plan.id);
    const mrr = money(sumRows(planTenants, (tenant) => tenant.monthlyRecurringRevenue));
    return {
      planId: plan.id,
      name: plan.name,
      tenantCount: planTenants.length,
      mrr,
      arr: money(mrr * 12),
      sharePct: share(mrr, metrics.monthlyRecurringRevenue),
      averageHealth: planTenants.length ? pct(sumRows(planTenants, (tenant) => tenant.healthScore) / planTenants.length) : 0
    };
  }).sort((a, b) => b.mrr - a.mrr);
  const statusMix = ["active", "trialing", "suspended", "cancelled"].map((status) => ({
    status,
    tenants: tenants.filter((tenant) => tenant.subscriptionStatus === status).length,
    mrr: money(sumRows(tenants.filter((tenant) => tenant.subscriptionStatus === status), (tenant) => tenant.monthlyRecurringRevenue))
  })).filter((row) => row.tenants || row.mrr);
  const suspendedMrrAtRisk = money(sumRows(tenants.filter((tenant) => tenant.subscriptionStatus === "suspended"), (tenant) => tenant.monthlyRecurringRevenue));
  const trialMrr = money(sumRows(tenants.filter((tenant) => tenant.subscriptionStatus === "trialing"), (tenant) => tenant.monthlyRecurringRevenue));
  return {
    arr: money(metrics.monthlyRecurringRevenue * 12),
    arpu: activeTenants.length ? money(metrics.monthlyRecurringRevenue / activeTenants.length) : 0,
    revenueQuality: share(metrics.monthlyRecurringRevenue, metrics.monthlyRecurringRevenue + metrics.outstanding),
    outstanding: metrics.outstanding,
    suspendedMrrAtRisk,
    trialMrr,
    planMix,
    statusMix,
    topRevenueTenants: tenants
      .slice()
      .sort((a, b) => b.totalBillingAmount - a.totalBillingAmount)
      .slice(0, 5)
      .map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        planName: tenant.planName,
        subscriptionStatus: tenant.subscriptionStatus,
        totalBillingAmount: tenant.totalBillingAmount,
        monthlyRecurringRevenue: tenant.monthlyRecurringRevenue,
        transactionRevenue: tenant.transactionRevenue,
        outstanding: tenant.outstanding,
        healthScore: tenant.healthScore
      })),
    revenueRisks: tenants
      .filter((tenant) => tenant.outstanding > 0 || tenant.subscriptionStatus === "suspended" || tenant.healthScore < 45)
      .sort((a, b) => (b.outstanding + b.monthlyRecurringRevenue) - (a.outstanding + a.monthlyRecurringRevenue))
      .slice(0, 6)
      .map((tenant) => ({
        tenantId: tenant.id,
        tenantName: tenant.name,
        severity: tenant.subscriptionStatus === "suspended" || tenant.outstanding > tenant.monthlyRecurringRevenue ? "high" : "medium",
        reason: tenant.subscriptionStatus === "suspended"
          ? "Subscription is suspended"
          : tenant.outstanding > 0
            ? "Outstanding billing balance"
            : "Low tenant health score",
        amountAtRisk: money(tenant.outstanding + tenant.monthlyRecurringRevenue),
        healthScore: tenant.healthScore
      }))
  };
}

export class SuperAdminService {
  overview(access) {
    ensureSuperAdmin(access);
    const tenants = repositories.tenants.list({ limit: 10000 });
    const plans = repositories.subscriptionPlans.list({ limit: 10000 });
    const subscriptions = repositories.subscriptions.list({ limit: 10000 });
    const sales = repositories.sales.list({ limit: 100000 });
    const invoices = repositories.invoices.list({ limit: 100000 });
    const payments = repositories.payments.list({ limit: 100000 });
    const tenantUsers = repositories.tenantUsers.list({ limit: 100000 });
    const auditRows = repositories.superAdminAudit.list({ limit: 1000 }).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const trustedDevicesByTenant = rowsByTenant("security_trusted_devices", "lastSeenAt", 2000);
    const riskEventsByTenant = rowsByTenant("security_risk_events", "createdAt", 2000);
    const privacyRequestsByTenant = rowsByTenant("security_privacy_requests", "createdAt", 1000);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const subscriptionByTenant = new Map(subscriptions.map((sub) => [sub.tenantId, sub]));
    const tenantLimitByTenant = new Map(repositories.settings
      .list({ limit: 10000 })
      .filter((setting) => setting.key === TENANT_LIMITS_KEY)
      .map((setting) => [setting.tenantId, setting.value || {}]));
    const ipAllowlistByTenant = new Map(repositories.settings
      .list({ limit: 10000 })
      .filter((setting) => setting.key === TENANT_IP_ALLOWLIST_KEY)
      .map((setting) => [setting.tenantId, setting.value || {}]));
    const dataExportControlsByTenant = new Map(repositories.settings
      .list({ limit: 10000 })
      .filter((setting) => setting.key === TENANT_DATA_EXPORT_CONTROLS_KEY)
      .map((setting) => [setting.tenantId, setting.value || {}]));
    const rolePermissionMatrixByTenant = new Map(repositories.settings
      .list({ limit: 10000 })
      .filter((setting) => setting.key === TENANT_ROLE_PERMISSION_MATRIX_KEY)
      .map((setting) => [setting.tenantId, setting.value || {}]));
    const ssoByTenant = latestSsoByTenant();
    let tenantRows = tenants.map((tenant) => {
      const tenantSales = sales.filter((sale) => sale.tenantId === tenant.id);
      const tenantInvoices = invoices.filter((invoice) => invoice.tenantId === tenant.id);
      const tenantPayments = payments.filter((payment) => payment.tenantId === tenant.id);
      const usersForTenant = tenantUsers.filter((user) => user.tenantId === tenant.id);
      const trustedDevicesForTenant = trustedDevicesByTenant.get(tenant.id) || [];
      const riskEventsForTenant = riskEventsByTenant.get(tenant.id) || [];
      const privacyRequestsForTenant = privacyRequestsByTenant.get(tenant.id) || [];
      const plan = planById.get(tenant.planId);
      const billingPreview = tenantService.billingPreview(tenant.id);
      const usage = {
        branches: count("branches", tenant.id),
        staff: count("staff", tenant.id),
        clients: count("clients", tenant.id),
        appointments: count("appointments", tenant.id),
        sales: tenantSales.length,
        campaigns: count("campaigns", tenant.id)
      };
      const monthlyRecurringRevenue = Number(plan?.priceMonthly || 0);
      const outstanding = money(sumRows(tenantInvoices.filter((invoice) => invoice.status !== "paid"), (invoice) => invoice.balance));
      const health = healthBreakdown(tenant, usage, outstanding, monthlyRecurringRevenue);
      const tenantLimits = tenantLimitsFor(plan, tenantLimitByTenant.get(tenant.id), usage);
      const ipAllowlist = ipAllowlistForTenant(ipAllowlistByTenant.get(tenant.id));
      const dataExportControls = dataExportControlsForTenant(dataExportControlsByTenant.get(tenant.id));
      const rolePermissionMatrix = rolePermissionMatrixForTenant(rolePermissionMatrixByTenant.get(tenant.id));
      const sso = ssoByTenant.get(tenant.id) || null;
      const row = {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        ownerEmail: tenant.ownerEmail,
        supportLinks: supportLinksForTenant(tenant),
        createdAt: tenant.createdAt || tenant.created_at || "",
        status: tenant.status,
        subscriptionStatus: tenant.subscriptionStatus,
        trialEndsAt: tenant.trialEndsAt,
        primaryDomain: tenant.primaryDomain,
        planName: plan?.name || tenant.planId,
        planId: tenant.planId,
        monthlyRecurringRevenue,
        meteredUsageRevenue: Number(billingPreview.usageAmount || 0),
        billingPreview,
        totalBillingAmount: Number(billingPreview.totalAmount || 0),
        transactionRevenue: money(sumRows(tenantSales, (sale) => sale.total)),
        outstanding,
        usage,
        tenantLimits,
        ipAllowlist,
        dataExportControls,
        rolePermissionMatrix,
        sso,
        enterpriseSecurity: enterpriseSecurityForTenant(plan, tenantLimits, ipAllowlist, sso || {}, dataExportControls),
        healthBreakdown: health,
        healthScore: tenantHealth(tenant, usage),
        subscription: subscriptionByTenant.get(tenant.id) || null
      };
      row.billingOps = tenantBillingOps(row, tenantInvoices, tenantPayments);
      const drilldown = tenantDrilldown(row, tenantInvoices, usersForTenant, auditRows, trustedDevicesForTenant, riskEventsForTenant, privacyRequestsForTenant);
      row.drilldown = drilldown;
      return {
        ...row,
        healthFlag: healthFlagFor(row),
        tenant360: tenant360(row),
        drilldown
      };
    });
    tenantRows = tenantRows.map((tenant) => ({ ...tenant, aiRiskScore: tenantAiRiskScore(tenant, auditRows) }));
    tenantRows = tenantRows.map((tenant) => ({
      ...tenant,
      riskTimeline: riskTimelineForTenant(tenant, auditRows),
      drilldown: {
        ...tenant.drilldown,
        riskTimeline: riskTimelineForTenant(tenant, auditRows)
      }
    }));
    const metrics = {
      salons: tenants.length,
      activeSalons: tenants.filter((tenant) => ["active", "trialing"].includes(tenant.subscriptionStatus)).length,
      suspendedSalons: tenants.filter((tenant) => tenant.subscriptionStatus === "suspended" || tenant.status === "suspended").length,
      trialSalons: tenants.filter((tenant) => tenant.subscriptionStatus === "trialing").length,
      monthlyRecurringRevenue: money(sumRows(tenantRows, (tenant) => tenant.monthlyRecurringRevenue)),
      meteredUsageRevenue: money(sumRows(tenantRows, (tenant) => tenant.meteredUsageRevenue)),
      totalPlatformBilling: money(sumRows(tenantRows, (tenant) => tenant.totalBillingAmount)),
      transactionRevenue: money(sumRows(tenantRows, (tenant) => tenant.transactionRevenue)),
      outstanding: money(sumRows(tenantRows, (tenant) => tenant.outstanding)),
      averageHealth: tenantRows.length ? pct(sumRows(tenantRows, (tenant) => tenant.healthScore) / tenantRows.length) : 0
    };
    const featureToggles = repositories.featureToggles.list({ limit: 10000 })
      .map((toggle) => enrichFeatureToggle(toggle, tenantRows, plans));
    const revenueGraph = revenueGrowthGraph(tenantRows);
    const actionInbox = actionInboxForTenants(tenantRows, auditRows);
    const safety = actionSafetyCommand(tenantRows, featureToggles);
    return {
      metrics,
      tenants: tenantRows.sort((a, b) => b.monthlyRecurringRevenue - a.monthlyRecurringRevenue),
      plans,
      featureToggles,
      featureFlagCommand: featureFlagCommand(featureToggles),
      tenantFeatureOverrides: tenantFeatureOverrideMatrix(featureToggles, tenantRows),
      actionSafetyCommand: safety,
      saasHealthEngine: saasHealthEngine(metrics, tenantRows, featureToggles),
      realtimeHealthAlerts: realtimeHealthAlerts(tenantRows),
      securityRiskCenter: securityRiskCenter(tenantRows, auditRows),
      revenueCommand: revenueCommand(metrics, tenantRows, plans),
      revenueIntelligence: revenueIntelligence(metrics, tenantRows, plans),
      revenueLeakageReport: revenueLeakageReport(metrics, tenantRows, featureToggles),
      billingOperationsReport: billingOperationsReport(tenantRows),
      usageQuotaBillingAlerts: usageQuotaBillingAlerts(tenantRows),
      revenueGrowthGraph: revenueGraph,
      revenueGrowthSummary: revenueGrowthSummary(revenueGraph),
      trialPaidFunnel: trialPaidFunnel(tenantRows),
      churnPrediction: churnPrediction(tenantRows),
      actionInbox,
      operationsPlaybooks: operationsPlaybooks(tenantRows, actionInbox),
      commandCenterNotifications: commandCenterNotifications(auditRows, actionInbox, safety.pendingApprovals),
      tenantRiskCommand: {
        alertCount: sumRows(tenantRows, (tenant) => tenant.tenant360.alertSummary.total),
        highRiskTenants: tenantRows
          .filter((tenant) => tenant.tenant360.alertSummary.high || tenant.healthScore < 45)
          .sort((a, b) => b.tenant360.alertSummary.high - a.tenant360.alertSummary.high || a.healthScore - b.healthScore)
          .slice(0, 8)
          .map((tenant) => ({
            id: tenant.id,
            name: tenant.name,
            healthScore: tenant.healthScore,
            alerts: tenant.tenant360.alertSummary,
            topAlert: tenant.tenant360.alerts[0] || null
          }))
      },
      insights: this.insights(metrics, tenantRows)
    };
  }

  analytics(input = {}, access) {
    ensureSuperAdmin(access);
    const periodEnd = input.periodEnd || now().slice(0, 10);
    const periodStart = input.periodStart || new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
    const overview = this.overview(access);
    const sales = repositories.sales.list({ limit: 100000 }).filter((sale) => {
      const key = String(sale.createdAt || "").slice(0, 10);
      return (!periodStart || key >= periodStart) && (!periodEnd || key <= periodEnd);
    });
    const planMix = overview.plans.map((plan) => ({
      planId: plan.id,
      name: plan.name,
      tenants: overview.tenants.filter((tenant) => tenant.planId === plan.id).length,
      mrr: money(sumRows(overview.tenants.filter((tenant) => tenant.planId === plan.id), (tenant) => tenant.monthlyRecurringRevenue))
    }));
    const metrics = {
      ...overview.metrics,
      periodStart,
      periodEnd,
      periodTransactionRevenue: money(sumRows(sales, (sale) => sale.total)),
      planMix,
      topTenants: overview.tenants.slice(0, 8)
    };
    const insights = this.insights(overview.metrics, overview.tenants);
    const snapshot = repositories.platformAnalytics.create({
      id: makeId("plat"),
      type: input.type || "global",
      periodStart,
      periodEnd,
      metrics,
      insights,
      status: "generated"
    });
    this.audit(access, "platform.analytics.generated", "platform_analytics_snapshot", snapshot.id, { periodStart, periodEnd });
    return { snapshot, metrics, insights };
  }

  suspendTenant(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const safety = requireSafetyConfirmation(payload, "tenant suspension/reactivation");
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const status = payload.status || "suspended";
    const updatedTenant = repositories.tenants.update(tenantId, {
      status,
      subscriptionStatus: status === "suspended" ? "suspended" : "active"
    });
    const subscription = db.prepare("SELECT id FROM subscriptions WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1").get(tenantId);
    if (subscription) {
      repositories.subscriptions.update(subscription.id, {
        status: status === "suspended" ? "suspended" : "active",
        cancelAt: status === "suspended" ? now() : ""
      }, { tenantId });
    }
    this.audit(access, status === "suspended" ? "tenant.suspended" : "tenant.reactivated", "tenant", tenantId, { reason: safety.reason, confirmation: safety.confirmation });
    return updatedTenant;
  }

  updateTenantSubscription(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const safety = requireSafetyConfirmation(payload, "subscription update");
    if (!payload.planId && !payload.status) throw badRequest("planId or status is required");
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const plan = payload.planId ? repositories.subscriptionPlans.getById(payload.planId) : null;
    if (payload.planId && !plan) throw badRequest("Plan does not exist");
    const updatedTenant = repositories.tenants.update(tenantId, {
      planId: payload.planId || tenant.planId,
      subscriptionStatus: payload.status || tenant.subscriptionStatus,
      status: payload.status === "suspended" ? "suspended" : tenant.status === "suspended" ? "active" : tenant.status
    });
    const existing = db.prepare("SELECT id FROM subscriptions WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 1").get(tenantId);
    const subscriptionPayload = {
      planId: payload.planId || tenant.planId,
      status: payload.status || tenant.subscriptionStatus,
      currentPeriodStart: payload.currentPeriodStart || now(),
      currentPeriodEnd: payload.currentPeriodEnd || new Date(Date.now() + 30 * 86400000).toISOString()
    };
    const subscription = existing
      ? repositories.subscriptions.update(existing.id, subscriptionPayload, { tenantId })
      : repositories.subscriptions.create({ id: makeId("sub"), ...subscriptionPayload }, { tenantId });
    this.audit(access, "tenant.subscription.updated", "tenant", tenantId, { planId: subscriptionPayload.planId, status: subscriptionPayload.status, reason: safety.reason, confirmation: safety.confirmation });
    return { tenant: updatedTenant, subscription, plan: plan || repositories.subscriptionPlans.getById(updatedTenant.planId) };
  }

  updateTenantLimits(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const plan = repositories.subscriptionPlans.getById(tenant.planId);
    const planDefaults = planLimitsFor(plan);
    const current = repositories.settings.list({ limit: 10000 }, { tenantId })
      .find((setting) => setting.key === TENANT_LIMITS_KEY);
    const limits = {
      ...planDefaults,
      ...(current?.value || {}),
      branches: tenantLimitValue(payload.branches, planDefaults.branches),
      staff: tenantLimitValue(payload.staff, planDefaults.staff),
      clients: tenantLimitValue(payload.clients, planDefaults.clients),
      supportTier: payload.supportTier || current?.value?.supportTier || planDefaults.supportTier
    };
    const record = current
      ? repositories.settings.update(current.id, { value: limits, scope: "tenant" }, { tenantId })
      : repositories.settings.create({ id: makeId("set"), key: TENANT_LIMITS_KEY, value: limits, scope: "tenant" }, { tenantId });
    this.audit(access, "tenant.limits.updated", "tenant", tenantId, {
      limits,
      reason: payload.reason || ""
    });
    return { tenantId, limits: record.value };
  }

  updateTenantIpAllowlist(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const current = repositories.settings.list({ limit: 10000 }, { tenantId })
      .find((setting) => setting.key === TENANT_IP_ALLOWLIST_KEY);
    const policy = parseIpAllowlist({
      ...current?.value,
      ...payload,
      entries: Array.isArray(payload.entries)
        ? payload.entries
        : String(payload.entriesText || "").split(/\r?\n|,/),
      updatedBy: access.userId || "super-admin",
      updatedAt: now()
    });
    const record = current
      ? repositories.settings.update(current.id, { value: policy, scope: "tenant" }, { tenantId })
      : repositories.settings.create({ id: makeId("set"), key: TENANT_IP_ALLOWLIST_KEY, value: policy, scope: "tenant" }, { tenantId });
    this.audit(access, "tenant.ip_allowlist.updated", "tenant", tenantId, {
      enabled: policy.enabled,
      mode: policy.mode,
      entries: policy.entries,
      reason: payload.reason || ""
    });
    return { tenantId, ipAllowlist: ipAllowlistForTenant(record.value) };
  }

  updateTenantSso(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const provider = String(payload.provider || "saml").trim() || "saml";
    const domainHint = String(payload.domainHint || tenant.primaryDomain || "").trim();
    const enforceForRoles = String(payload.enforceForRoles || "owner,admin,superAdmin").trim();
    const status = ["draft", "ready", "active", "enforced", "disabled"].includes(String(payload.status || "draft"))
      ? String(payload.status || "draft")
      : "draft";
    const existing = db.prepare("SELECT id FROM security_sso_settings WHERE tenantId = @tenantId ORDER BY updatedAt DESC LIMIT 1").get({ tenantId });
    const record = {
      id: payload.id || existing?.id || makeId("sso"),
      tenantId,
      branchId: "",
      provider,
      domainHint,
      enforceForRoles,
      status,
      createdAt: now(),
      updatedAt: now()
    };
    db.prepare(`
      INSERT INTO security_sso_settings
      (id, tenantId, branchId, provider, domainHint, enforceForRoles, status, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @provider, @domainHint, @enforceForRoles, @status, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, domainHint = excluded.domainHint,
        enforceForRoles = excluded.enforceForRoles, status = excluded.status, updatedAt = excluded.updatedAt
    `).run(record);
    this.audit(access, "tenant.sso.updated", "tenant", tenantId, {
      provider,
      domainHint,
      enforceForRoles,
      status,
      reason: payload.reason || ""
    });
    return { tenantId, sso: record };
  }

  updateTenantDataExportControls(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const current = repositories.settings.list({ limit: 10000 }, { tenantId })
      .find((setting) => setting.key === TENANT_DATA_EXPORT_CONTROLS_KEY);
    const policy = parseDataExportControls({
      ...current?.value,
      ...payload,
      allowedFormats: Array.isArray(payload.allowedFormats)
        ? payload.allowedFormats
        : String(payload.formatsText || "").split(/\r?\n|,/),
      updatedBy: access.userId || "super-admin",
      updatedAt: now()
    });
    const record = current
      ? repositories.settings.update(current.id, { value: policy, scope: "tenant" }, { tenantId })
      : repositories.settings.create({ id: makeId("set"), key: TENANT_DATA_EXPORT_CONTROLS_KEY, value: policy, scope: "tenant" }, { tenantId });
    this.audit(access, "tenant.data_export_controls.updated", "tenant", tenantId, {
      enabled: policy.enabled,
      approvalRequired: policy.approvalRequired,
      piiMasking: policy.piiMasking,
      allowedFormats: policy.allowedFormats,
      maxRows: policy.maxRows,
      retentionDays: policy.retentionDays,
      reason: payload.reason || ""
    });
    return { tenantId, dataExportControls: dataExportControlsForTenant(record.value) };
  }

  updateTenantRolePermissionMatrix(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const current = repositories.settings.list({ limit: 10000 }, { tenantId })
      .find((setting) => setting.key === TENANT_ROLE_PERMISSION_MATRIX_KEY);
    const policy = parseRolePermissionMatrix({
      ...current?.value,
      ...payload,
      updatedBy: access.userId || "super-admin",
      updatedAt: now()
    });
    const record = current
      ? repositories.settings.update(current.id, { value: policy, scope: "tenant" }, { tenantId })
      : repositories.settings.create({ id: makeId("set"), key: TENANT_ROLE_PERMISSION_MATRIX_KEY, value: policy, scope: "tenant" }, { tenantId });
    this.audit(access, "tenant.role_permission_matrix.updated", "tenant", tenantId, {
      role: payload.role || "",
      permissions: policy.roles[String(payload.role || "").trim().toLowerCase()] || [],
      privilegedRoles: rolePermissionMatrixForTenant(record.value).privilegedRoles,
      reason: payload.reason || ""
    });
    return { tenantId, rolePermissionMatrix: rolePermissionMatrixForTenant(record.value) };
  }

  initiateTenantGdprExport(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const safety = requireSafetyConfirmation(payload, "GDPR tenant data export");
    const controlsRecord = repositories.settings.list({ limit: 10000 }, { tenantId })
      .find((setting) => setting.key === TENANT_DATA_EXPORT_CONTROLS_KEY);
    const controls = dataExportControlsForTenant(controlsRecord?.value || {});
    if (!controls.enabled) throw badRequest("Data exports are disabled for this tenant");
    const timestamp = now();
    const manifest = exportManifestForTenant(tenantId);
    const status = controls.approvalRequired ? "approval_required" : "open";
    const record = {
      id: makeId("privacy"),
      tenantId,
      branchId: "",
      requesterId: access.userId || "super-admin",
      subjectType: "tenant",
      subjectId: tenantId,
      requestType: "gdpr_full_export",
      summary: `Full GDPR data export initiated for ${tenant.name}. ${manifest.totalTables} tables and ${manifest.totalRows} rows queued for review.`,
      status,
      resolvedAt: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.prepare(`
      INSERT INTO security_privacy_requests
      (id, tenantId, branchId, requesterId, subjectType, subjectId, requestType, summary, status, resolvedAt, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @requesterId, @subjectType, @subjectId, @requestType, @summary, @status, @resolvedAt, @createdAt, @updatedAt)
    `).run(record);
    this.audit(access, "tenant.gdpr_export.initiated", "tenant", tenantId, {
      requestId: record.id,
      status,
      manifest,
      controls: {
        approvalRequired: controls.approvalRequired,
        piiMasking: controls.piiMasking,
        watermark: controls.watermark,
        allowedFormats: controls.allowedFormats,
        retentionDays: controls.retentionDays
      },
      reason: safety.reason,
      confirmation: safety.confirmation
    });
    return { tenantId, exportRequest: record, controls, manifest };
  }

  bulkTenantAction(payload = {}, access) {
    ensureSuperAdmin(access);
    const safety = requireSafetyConfirmation(payload, "bulk tenant action");
    const tenantIds = Array.isArray(payload.tenantIds) ? [...new Set(payload.tenantIds.filter(Boolean))] : [];
    if (!tenantIds.length) throw badRequest("tenantIds are required");
    const action = String(payload.action || "");
    if (!["suspend", "reactivate", "changePlan", "sendEmail", "export", "assignOwner"].includes(action)) throw badRequest("Unsupported bulk action");
    if (action === "changePlan" && !payload.planId) throw badRequest("planId is required for bulk plan change");
    if (action === "sendEmail" && !String(payload.emailBody || "").trim()) throw badRequest("emailBody is required for bulk email");
    if (action === "assignOwner" && !String(payload.supportOwner || "").trim()) throw badRequest("supportOwner is required for support owner assignment");
    if (payload.planId && !repositories.subscriptionPlans.getById(payload.planId)) throw badRequest("Plan does not exist");

    const results = tenantIds.map((tenantId) => {
      const tenant = repositories.tenants.getById(tenantId);
      if (!tenant) return { tenantId, status: "not_found" };
      if (action === "export") {
        try {
          const exportResult = this.initiateTenantGdprExport(tenantId, {
            reason: safety.reason,
            confirmation: safety.confirmation
          }, access);
          return {
            tenantId,
            status: "queued",
            exportRequestId: exportResult.exportRequest.id,
            exportStatus: exportResult.exportRequest.status,
            manifest: exportResult.manifest
          };
        } catch (error) {
          return { tenantId, status: "failed", error: error?.message || "Unable to queue export" };
        }
      }
      if (action === "assignOwner") {
        const supportOwner = String(payload.supportOwner || "").trim();
        const assignment = this.audit(access, "tenant.support_owner.assigned", "tenant", tenantId, {
          supportOwner,
          reason: safety.reason,
          confirmation: safety.confirmation,
          queue: supportOwner,
          assignedAt: now()
        });
        return { tenantId, status: "assigned", supportOwner, auditId: assignment.id };
      }
      if (action === "sendEmail") {
        if (!tenant.ownerEmail) return { tenantId, status: "missing_email" };
        const message = repositories.messageLogs.create({
          id: makeId("msg"),
          branchId: "",
          channel: "email",
          recipient: tenant.ownerEmail,
          message: payload.emailBody,
          direction: "outbound",
          status: "queued",
          payload: {
            subject: payload.emailSubject || "Aura platform update",
            tenantId,
            source: "super-admin-bulk-action"
          }
        }, { tenantId });
        this.audit(access, "tenant.bulk_email.queued", "tenant", tenantId, { reason: safety.reason, recipient: tenant.ownerEmail, messageLogId: message.id });
        return { tenantId, status: "queued", messageLogId: message.id };
      }
      if (action === "changePlan") {
        const updated = this.updateTenantSubscription(tenantId, { planId: payload.planId, reason: safety.reason, confirmation: safety.confirmation }, access);
        return { tenantId, status: "updated", tenant: updated.tenant };
      }
      const updated = this.suspendTenant(tenantId, {
        status: action === "suspend" ? "suspended" : "active",
        reason: safety.reason,
        confirmation: safety.confirmation
      }, access);
      return { tenantId, status: "updated", tenant: updated };
    });
    const summary = {
      action,
      tenantIds,
      planId: payload.planId || "",
      emailSubject: payload.emailSubject || "",
      supportOwner: payload.supportOwner || "",
      reason: safety.reason,
      confirmation: safety.confirmation,
      updated: results.filter((row) => ["updated", "queued", "assigned"].includes(row.status)).length,
      failed: results.filter((row) => !["updated", "queued", "assigned"].includes(row.status)).length
    };
    this.audit(access, "tenant.bulk_action.executed", "tenant", "bulk", summary);
    return { summary, results };
  }

  broadcastHealthAlerts(access) {
    ensureSuperAdmin(access);
    const overview = this.overview(access);
    const alerts = overview.realtimeHealthAlerts || [];
    const events = alerts.map((alert) => realtimeService.broadcast("super-admin.health.alert", alert, {
      tenantId: alert.tenantId,
      channel: `tenant:${alert.tenantId}`
    })).filter(Boolean);
    this.audit(access, "health_alerts.broadcast", "tenant", "bulk", { count: alerts.length });
    return { alerts, events: events.length };
  }

  dispatchQuotaAlerts(payload = {}, access) {
    ensureSuperAdmin(access);
    const overview = this.overview(access);
    const requestedTenantIds = Array.isArray(payload.tenantIds) ? new Set(payload.tenantIds.filter(Boolean)) : null;
    const alerts = (overview.usageQuotaBillingAlerts?.quotaAlerts || [])
      .filter((alert) => alert.severity === "critical")
      .filter((alert) => !requestedTenantIds || requestedTenantIds.has(alert.tenantId));
    const tenantsById = new Map(overview.tenants.map((tenant) => [tenant.id, tenant]));
    const results = alerts.map((alert) => {
      const tenant = tenantsById.get(alert.tenantId);
      if (!tenant) return { tenantId: alert.tenantId, metric: alert.metric, status: "tenant_missing" };
      const eventKey = quotaAlertEventKey(alert);
      const existing = repositories.messageLogs.list({ limit: 10000 }, { tenantId: alert.tenantId })
        .find((message) => message.payload?.eventKey === eventKey && message.payload?.source === "super-admin-quota-alert");
      if (existing) return { tenantId: alert.tenantId, metric: alert.metric, status: "already_queued", messageLogId: existing.id, supportTicketLink: alert.supportTicketLink };
      const body = `Quota crossed for ${tenant.name}: ${alert.metric} is ${alert.used}/${alert.limit} (${alert.usagePct}%). Support ticket: ${alert.supportTicketLink}`;
      const email = tenant.ownerEmail
        ? repositories.messageLogs.create({
            id: makeId("msg"),
            branchId: "",
            channel: "email",
            recipient: tenant.ownerEmail,
            message: body,
            direction: "outbound",
            status: "queued",
            payload: {
              subject: `Quota crossed: ${alert.metric}`,
              source: "super-admin-quota-alert",
              eventKey,
              alert,
              supportTicketLink: alert.supportTicketLink
            }
          }, { tenantId: alert.tenantId })
        : null;
      const webhook = repositories.messageLogs.create({
        id: makeId("msg"),
        branchId: "",
        channel: "webhook",
        recipient: "tenant.quota_crossed",
        message: JSON.stringify({ eventType: "tenant.quota_crossed", eventKey, alert, supportTicketLink: alert.supportTicketLink }),
        direction: "outbound",
        status: "queued",
        payload: {
          source: "super-admin-quota-alert",
          eventType: "tenant.quota_crossed",
          eventKey,
          alert,
          supportTicketLink: alert.supportTicketLink
        }
      }, { tenantId: alert.tenantId });
      const event = realtimeService.broadcast("tenant.quota_crossed", {
        eventKey,
        alert,
        supportTicketLink: alert.supportTicketLink
      }, {
        tenantId: alert.tenantId,
        channel: `tenant:${alert.tenantId}`
      });
      this.audit(access, "tenant.quota_alert.dispatched", "tenant", alert.tenantId, {
        eventKey,
        metric: alert.metric,
        used: alert.used,
        limit: alert.limit,
        usagePct: alert.usagePct,
        emailMessageLogId: email?.id || "",
        webhookMessageLogId: webhook.id,
        supportTicketLink: alert.supportTicketLink
      });
      return {
        tenantId: alert.tenantId,
        metric: alert.metric,
        status: "queued",
        emailMessageLogId: email?.id || "",
        webhookMessageLogId: webhook.id,
        realtimeEventId: event?.id || "",
        supportTicketLink: alert.supportTicketLink
      };
    });
    const summary = {
      alerts: alerts.length,
      queued: results.filter((item) => item.status === "queued").length,
      skipped: results.filter((item) => item.status !== "queued").length
    };
    this.audit(access, "tenant.quota_alert.batch_dispatched", "tenant", "bulk", summary);
    return { summary, results };
  }

  requestActionApproval(payload = {}, access) {
    ensureSuperAdmin(access);
    const safety = requireSafetyConfirmation(payload, "approval request");
    if (!payload.action || !payload.targetType || !payload.targetId) throw badRequest("action, targetType and targetId are required");
    return this.audit(access, "super_admin.action_approval.requested", payload.targetType, payload.targetId, {
      action: payload.action,
      reason: safety.reason,
      confirmation: safety.confirmation,
      priority: payload.priority || "medium",
      status: "pending",
      requestedAt: now()
    });
  }

  resolveActionApproval(requestId, payload = {}, access) {
    ensureSuperAdmin(access);
    const safety = requireSafetyConfirmation(payload, "approval resolution");
    const request = repositories.superAdminAudit.getById(requestId);
    if (!request || request.action !== "super_admin.action_approval.requested") throw notFound("Approval request not found");
    const status = ["approved", "rejected"].includes(payload.status) ? payload.status : "";
    if (!status) throw badRequest("status must be approved or rejected");
    return this.audit(access, "super_admin.action_approval.resolved", request.targetType, request.targetId, {
      requestId,
      status,
      reason: safety.reason,
      confirmation: safety.confirmation,
      resolvedAt: now()
    });
  }

  updateActionInboxItem(itemId, payload = {}, access) {
    ensureSuperAdmin(access);
    const action = String(payload.action || "").trim();
    const statuses = {
      assign: "open",
      snooze: "snoozed",
      resolve: "resolved",
      escalate: "escalated",
      note: "open"
    };
    if (!statuses[action]) throw badRequest("Unsupported action inbox update");
    const tenantId = String(payload.tenantId || "").trim();
    if (tenantId && !repositories.tenants.getById(tenantId)) throw notFound("Tenant not found");
    const ownerQueue = String(payload.ownerQueue || payload.supportOwner || "").trim();
    const note = String(payload.note || "").trim();
    if (["assign", "escalate"].includes(action) && !ownerQueue) throw badRequest("ownerQueue is required");
    if (action === "note" && !note) throw badRequest("note is required");
    const dueInDays = Math.max(0, Math.min(30, Math.round(Number(payload.dueInDays ?? (action === "snooze" ? 3 : action === "escalate" ? 1 : 2)))));
    const audit = this.audit(access, "super_admin.action_inbox.updated", "action_inbox", itemId, {
      itemId,
      tenantId,
      action,
      status: statuses[action],
      ownerQueue,
      note,
      dueInDays,
      updatedAt: now()
    });
    if (tenantId && action === "note" && note) {
      this.audit(access, "tenant.support_note.added", "tenant", tenantId, {
        note,
        visibility: "internal",
        source: "action_inbox",
        itemId
      });
    }
    if (tenantId && ["assign", "escalate"].includes(action)) {
      this.audit(access, "tenant.support_owner.assigned", "tenant", tenantId, {
        supportOwner: ownerQueue,
        queue: ownerQueue,
        source: "action_inbox",
        itemId,
        status: statuses[action],
        dueInDays,
        assignedAt: now()
      });
    }
    return { itemId, status: statuses[action], auditId: audit.id, ownerQueue, note, dueInDays };
  }

  runOperationsPlaybook(key, payload = {}, access) {
    ensureSuperAdmin(access);
    const allowed = new Map([
      ["billing_recovery", { category: "billing", ownerQueue: "finance_recovery", title: "Billing recovery" }],
      ["adoption_rescue", { category: "usage", ownerQueue: "customer_success_watch", title: "Adoption rescue" }],
      ["trial_conversion", { category: "churn", ownerQueue: "sales_conversion", title: "Trial conversion" }],
      ["security_hardening", { category: "security", ownerQueue: "security_success", title: "Security hardening" }],
      ["churn_prevention", { category: "churn", ownerQueue: "customer_success_urgent", title: "Churn prevention" }]
    ]);
    const playbook = allowed.get(String(key || ""));
    if (!playbook) throw badRequest("Unsupported operations playbook");
    const note = String(payload.note || `Run ${playbook.title} playbook`).trim();
    const tenantIds = Array.isArray(payload.tenantIds) ? payload.tenantIds.filter(Boolean).slice(0, 100) : [];
    const audit = this.audit(access, "super_admin.playbook.run", "operations_playbook", key, {
      key,
      title: playbook.title,
      category: playbook.category,
      ownerQueue: payload.ownerQueue || playbook.ownerQueue,
      tenantIds,
      note,
      runAt: now()
    });
    const assignments = tenantIds
      .filter((tenantId) => repositories.tenants.getById(tenantId))
      .map((tenantId) => this.audit(access, "tenant.support_owner.assigned", "tenant", tenantId, {
        supportOwner: payload.ownerQueue || playbook.ownerQueue,
        queue: payload.ownerQueue || playbook.ownerQueue,
        source: "operations_playbook",
        playbookKey: key,
        note,
        assignedAt: now()
      }));
    return { playbook: { key, ...playbook }, auditId: audit.id, assigned: assignments.length };
  }

  addSupportNote(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const note = String(payload.note || "").trim();
    if (note.length < 3) throw badRequest("Support note is required");
    return this.audit(access, "tenant.support_note.added", "tenant", tenantId, {
      note,
      visibility: payload.visibility || "internal"
    });
  }

  impersonateTenant(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
    const tenant = repositories.tenants.getById(tenantId);
    if (!tenant) throw notFound("Tenant not found");
    const reason = String(payload.reason || "").trim();
    const confirmation = String(payload.confirmation || "").trim();
    if (reason.length < 5) throw badRequest("Impersonation reason is required");
    if (confirmation !== "IMPERSONATE") throw badRequest("Type IMPERSONATE to start tenant impersonation");
    const users = repositories.tenantUsers.list({ limit: 10000 }, { tenantId });
    const owner = users.find((user) => ["owner", "admin"].includes(String(user.role || "").toLowerCase()) && (!user.status || user.status === "active"))
      || users.find((user) => !user.status || user.status === "active");
    const branch = db.prepare("SELECT id FROM branches WHERE tenantId = @tenantId ORDER BY createdAt ASC LIMIT 1").get({ tenantId });
    const branchId = String(payload.branchId || branch?.id || "");
    const impersonatedUser = owner || {
      id: `impersonation_${tenant.id}`,
      name: "Super Admin Impersonation",
      email: tenant.ownerEmail || "support@aurasalon.local",
      loginId: "super-admin-impersonation",
      role: "owner",
      staffId: "",
      branchIds: branch?.id ? [branch.id] : []
    };
    const session = authService.issueTokenPair({
      tenant,
      user: {
        ...impersonatedUser,
        role: owner?.role || "owner",
        branchIds: Array.isArray(impersonatedUser.branchIds) ? impersonatedUser.branchIds : branch?.id ? [branch.id] : []
      },
      branchId,
      deviceId: `impersonation:${access.userId || "super-admin"}`
    });
    const expiresAt = new Date(Date.now() + Number(session.expiresIn || 0) * 1000).toISOString();
    const audit = this.audit(access, "tenant.impersonation.started", "tenant", tenantId, {
      reason,
      confirmation,
      impersonatedUserId: impersonatedUser.id,
      impersonatedRole: session.user.role,
      branchId,
      returnPath: payload.returnPath || "/",
      expiresAt,
      restrictions: ["refunds", "staff_payroll", "password_change", "destructive_delete"]
    });
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      session,
      launchUrl: payload.returnPath || "/",
      expiresAt,
      auditId: audit.id,
      scope: {
        impersonatedUserId: impersonatedUser.id,
        impersonatedUserEmail: impersonatedUser.email || "",
        impersonatedRole: session.user.role,
        branchId
      },
      banner: `Impersonating ${tenant.name} for support debugging`,
      restrictions: ["Refunds require approval", "Payroll and password changes remain protected", "All actions are audit logged"]
    };
  }

  createPlan(payload = {}, access) {
    ensureSuperAdmin(access);
    if (!payload.name || !payload.code) throw badRequest("name and code are required");
    const existing = repositories.subscriptionPlans.list({ limit: 10000 }).find((plan) => plan.code === payload.code);
    if (existing) throw badRequest("Plan code already exists");
    const plan = repositories.subscriptionPlans.create({
      id: payload.id || makeId("plan"),
      name: payload.name,
      code: payload.code,
      priceMonthly: Number(payload.priceMonthly || 0),
      trialDays: Number(payload.trialDays || 14),
      limits: payload.limits || {},
      features: payload.features || [],
      status: payload.status || "active"
    });
    this.audit(access, "plan.created", "subscription_plan", plan.id, { code: plan.code });
    return plan;
  }

  updatePlan(planId, payload = {}, access) {
    ensureSuperAdmin(access);
    const plan = repositories.subscriptionPlans.getById(planId);
    if (!plan) throw notFound("Plan not found");
    const updated = repositories.subscriptionPlans.update(planId, {
      name: payload.name ?? plan.name,
      code: payload.code ?? plan.code,
      priceMonthly: Number(payload.priceMonthly ?? plan.priceMonthly),
      trialDays: Number(payload.trialDays ?? plan.trialDays),
      limits: payload.limits ?? plan.limits,
      features: payload.features ?? plan.features,
      status: payload.status ?? plan.status
    });
    this.audit(access, "plan.updated", "subscription_plan", planId, payload);
    return updated;
  }

  upsertFeatureToggle(payload = {}, access) {
    ensureSuperAdmin(access);
    if (!payload.key || !payload.name) throw badRequest("key and name are required");
    const scope = payload.scope || "global";
    if (scope === "tenant" && !payload.tenantId) throw badRequest("tenantId is required for tenant-scoped flags");
    if (scope === "plan" && !payload.planId) throw badRequest("planId is required for plan-scoped flags");
    if (payload.tenantId && !repositories.tenants.getById(payload.tenantId)) throw badRequest("Tenant target does not exist");
    if (payload.planId && !repositories.subscriptionPlans.getById(payload.planId)) throw badRequest("Plan target does not exist");
    const key = scopedFeatureKey(payload.key, scope, payload.tenantId, payload.planId);
    const existing = repositories.featureToggles.list({ limit: 10000 }).find((toggle) => toggle.key === key);
    const rules = {
      ...normalizeRules(payload.rules),
      baseKey: payload.key,
      rolloutPercentage: clampPercent(payload.rolloutPercentage ?? normalizeRules(payload.rules).rolloutPercentage),
      expiresAt: payload.expiresAt || normalizeRules(payload.rules).expiresAt || "",
      killSwitch: Boolean(payload.killSwitch ?? normalizeRules(payload.rules).killSwitch),
      dependencyKey: payload.dependencyKey || normalizeRules(payload.rules).dependencyKey || "",
      updatedBy: access.userId || "system",
      updatedAt: now()
    };
    const record = {
      key,
      name: payload.name,
      description: payload.description || "",
      scope,
      tenantId: scope === "tenant" ? payload.tenantId || "" : "",
      planId: scope === "plan" ? payload.planId || "" : "",
      enabled: rules.killSwitch ? 0 : payload.enabled ? 1 : 0,
      rules
    };
    const toggle = existing
      ? repositories.featureToggles.update(existing.id, record)
      : repositories.featureToggles.create({ id: makeId("ft"), ...record });
    this.audit(access, existing ? "feature_toggle.updated" : "feature_toggle.created", "feature_toggle", toggle.id, {
      key: toggle.key,
      enabled: toggle.enabled,
      scope: record.scope,
      tenantId: record.tenantId,
      planId: record.planId,
      rules
    });
    return toggle;
  }

  setFeatureToggleEnabled(id, enabled, access) {
    ensureSuperAdmin(access);
    const row = repositories.featureToggles.getById(id);
    if (!row) throw notFound("Feature toggle not found");
    const updated = repositories.featureToggles.update(id, { enabled: enabled ? 1 : 0, updatedAt: now() });
    this.audit(access, "feature_toggle.enabled_changed", "feature_toggle", id, { key: row.key, enabled: !!enabled });
    return updated;
  }

  deleteFeatureToggle(id, access) {
    ensureSuperAdmin(access);
    const row = repositories.featureToggles.getById(id);
    if (!row) throw notFound("Feature toggle not found");
    repositories.featureToggles.delete(id);
    this.audit(access, "feature_toggle.deleted", "feature_toggle", id, { key: row.key });
    return { ok: true, id };
  }

  audit(access, action, targetType, targetId, details = {}) {
    return repositories.superAdminAudit.create({
      id: makeId("audit"),
      actorUserId: access.userId || "system",
      action,
      targetType,
      targetId,
      details,
      createdAt: now()
    });
  }

  insights(metrics, tenants) {
    const insights = [];
    insights.push(`Platform MRR is INR ${metrics.monthlyRecurringRevenue} across ${metrics.salons} salons.`);
    if (metrics.suspendedSalons) insights.push(`${metrics.suspendedSalons} salons are suspended and need account review.`);
    const weak = tenants.filter((tenant) => tenant.healthScore < 45);
    if (weak.length) insights.push(`${weak.length} tenants have low health scores; review usage, support tickets and payment status.`);
    const top = tenants[0];
    if (top) insights.push(`${top.name} leads platform revenue with INR ${top.monthlyRecurringRevenue} MRR and INR ${top.transactionRevenue} tenant sales.`);
    return insights;
  }
}

export const superAdminService = new SuperAdminService();
