import { db } from "../db.js";
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
    return {
      id: tenant.id,
      name: tenant.name,
      planName: tenant.planName,
      subscriptionStatus: tenant.subscriptionStatus,
      churnScore,
      probability: churnScore >= 70 ? "high" : churnScore >= 40 ? "medium" : "low",
      mrrAtRisk: tenant.monthlyRecurringRevenue,
      outstanding: tenant.outstanding,
      drivers,
      recommendedAction: drivers.includes("billing exposure")
        ? "Run billing recovery"
        : drivers.includes("low adoption")
          ? "Schedule adoption rescue"
          : drivers.includes("trial ending")
            ? "Convert trial before expiry"
            : "Monitor account"
    };
  });
  return {
    highRiskCount: predictions.filter((item) => item.probability === "high").length,
    mediumRiskCount: predictions.filter((item) => item.probability === "medium").length,
    mrrAtRisk: money(sumRows(predictions.filter((item) => item.probability !== "low"), (item) => item.mrrAtRisk)),
    tenants: predictions
      .filter((item) => item.churnScore > 0)
      .sort((a, b) => b.churnScore - a.churnScore)
      .slice(0, 10)
  };
}

function tenantDrilldown(tenant, tenantInvoices, tenantUsers, auditRows) {
  const lastLoginAt = tenantUsers
    .map((user) => user.lastLoginAt || "")
    .filter(Boolean)
    .sort()
    .pop() || "";
  const supportNotes = auditRows
    .filter((row) => row.targetType === "tenant" && row.targetId === tenant.id && row.action === "tenant.support_note.added")
    .slice(0, 8)
    .map((row) => {
      const details = normalizeRules(row.details);
      return {
        id: row.id,
        note: details.note || details.reason || "",
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
        summary: details.note || details.reason || details.status || details.planId || details.key || ""
      };
    });
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
    const tenantRows = tenants.map((tenant) => {
      const tenantSales = sales.filter((sale) => sale.tenantId === tenant.id);
      const tenantInvoices = invoices.filter((invoice) => invoice.tenantId === tenant.id);
      const tenantPayments = payments.filter((payment) => payment.tenantId === tenant.id);
      const usersForTenant = tenantUsers.filter((user) => user.tenantId === tenant.id);
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
        tenantLimits: tenantLimitsFor(plan, tenantLimitByTenant.get(tenant.id), usage),
        ipAllowlist: ipAllowlistForTenant(ipAllowlistByTenant.get(tenant.id)),
        healthBreakdown: health,
        healthScore: tenantHealth(tenant, usage),
        subscription: subscriptionByTenant.get(tenant.id) || null
      };
      row.billingOps = tenantBillingOps(row, tenantInvoices, tenantPayments);
      return { ...row, healthFlag: healthFlagFor(row), tenant360: tenant360(row), drilldown: tenantDrilldown(row, tenantInvoices, usersForTenant, auditRows) };
    });
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
    return {
      metrics,
      tenants: tenantRows.sort((a, b) => b.monthlyRecurringRevenue - a.monthlyRecurringRevenue),
      plans,
      featureToggles,
      featureFlagCommand: featureFlagCommand(featureToggles),
      tenantFeatureOverrides: tenantFeatureOverrideMatrix(featureToggles, tenantRows),
      actionSafetyCommand: actionSafetyCommand(tenantRows, featureToggles),
      saasHealthEngine: saasHealthEngine(metrics, tenantRows, featureToggles),
      realtimeHealthAlerts: realtimeHealthAlerts(tenantRows),
      revenueCommand: revenueCommand(metrics, tenantRows, plans),
      revenueIntelligence: revenueIntelligence(metrics, tenantRows, plans),
      revenueLeakageReport: revenueLeakageReport(metrics, tenantRows, featureToggles),
      billingOperationsReport: billingOperationsReport(tenantRows),
      usageQuotaBillingAlerts: usageQuotaBillingAlerts(tenantRows),
      revenueGrowthGraph: revenueGrowthGraph(tenantRows),
      trialPaidFunnel: trialPaidFunnel(tenantRows),
      churnPrediction: churnPrediction(tenantRows),
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

  bulkTenantAction(payload = {}, access) {
    ensureSuperAdmin(access);
    const safety = requireSafetyConfirmation(payload, "bulk tenant action");
    const tenantIds = Array.isArray(payload.tenantIds) ? [...new Set(payload.tenantIds.filter(Boolean))] : [];
    if (!tenantIds.length) throw badRequest("tenantIds are required");
    const action = String(payload.action || "");
    if (!["suspend", "reactivate", "changePlan", "sendEmail"].includes(action)) throw badRequest("Unsupported bulk action");
    if (action === "changePlan" && !payload.planId) throw badRequest("planId is required for bulk plan change");
    if (action === "sendEmail" && !String(payload.emailBody || "").trim()) throw badRequest("emailBody is required for bulk email");
    if (payload.planId && !repositories.subscriptionPlans.getById(payload.planId)) throw badRequest("Plan does not exist");

    const results = tenantIds.map((tenantId) => {
      const tenant = repositories.tenants.getById(tenantId);
      if (!tenant) return { tenantId, status: "not_found" };
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
      reason: safety.reason,
      confirmation: safety.confirmation,
      updated: results.filter((row) => ["updated", "queued"].includes(row.status)).length,
      failed: results.filter((row) => !["updated", "queued"].includes(row.status)).length
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
    const branch = db.prepare("SELECT id FROM branches WHERE tenantId = ? ORDER BY createdAt ASC LIMIT 1").get(tenantId);
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
      branchId: payload.branchId || branch?.id || "",
      deviceId: `impersonation:${access.userId || "super-admin"}`
    });
    const expiresAt = new Date(Date.now() + Number(session.expiresIn || 0) * 1000).toISOString();
    const audit = this.audit(access, "tenant.impersonation.started", "tenant", tenantId, {
      reason,
      confirmation,
      impersonatedUserId: impersonatedUser.id,
      impersonatedRole: session.user.role,
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
