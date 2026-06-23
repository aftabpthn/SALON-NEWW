import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { tenantService } from "./tenant.service.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const pct = (value) => Math.round((Number(value) || 0) * 100) / 100;

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

function tenantHealth(tenant, rows) {
  const overdue = tenant.subscriptionStatus === "suspended" || tenant.status === "suspended";
  const activityScore = Math.min(100, rows.appointments * 5 + rows.sales * 8 + rows.clients * 2);
  const subscriptionScore = overdue ? 5 : tenant.subscriptionStatus === "trialing" ? 72 : 95;
  return pct((activityScore + subscriptionScore) / 2);
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
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const subscriptionByTenant = new Map(subscriptions.map((sub) => [sub.tenantId, sub]));
    const tenantRows = tenants.map((tenant) => {
      const tenantSales = sales.filter((sale) => sale.tenantId === tenant.id);
      const tenantInvoices = invoices.filter((invoice) => invoice.tenantId === tenant.id);
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
      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        ownerEmail: tenant.ownerEmail,
        status: tenant.status,
        subscriptionStatus: tenant.subscriptionStatus,
        trialEndsAt: tenant.trialEndsAt,
        primaryDomain: tenant.primaryDomain,
        planName: plan?.name || tenant.planId,
        planId: tenant.planId,
        monthlyRecurringRevenue: Number(plan?.priceMonthly || 0),
        meteredUsageRevenue: Number(billingPreview.usageAmount || 0),
        billingPreview,
        totalBillingAmount: Number(billingPreview.totalAmount || 0),
        transactionRevenue: money(sumRows(tenantSales, (sale) => sale.total)),
        outstanding: money(sumRows(tenantInvoices.filter((invoice) => invoice.status !== "paid"), (invoice) => invoice.balance)),
        usage,
        healthScore: tenantHealth(tenant, usage),
        subscription: subscriptionByTenant.get(tenant.id) || null
      };
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
    return {
      metrics,
      tenants: tenantRows.sort((a, b) => b.monthlyRecurringRevenue - a.monthlyRecurringRevenue),
      plans,
      featureToggles: repositories.featureToggles.list({ limit: 10000 }),
      revenueCommand: revenueCommand(metrics, tenantRows, plans),
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
    this.audit(access, status === "suspended" ? "tenant.suspended" : "tenant.reactivated", "tenant", tenantId, { reason: payload.reason || "" });
    return updatedTenant;
  }

  updateTenantSubscription(tenantId, payload = {}, access) {
    ensureSuperAdmin(access);
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
    this.audit(access, "tenant.subscription.updated", "tenant", tenantId, { planId: subscriptionPayload.planId, status: subscriptionPayload.status });
    return { tenant: updatedTenant, subscription, plan: plan || repositories.subscriptionPlans.getById(updatedTenant.planId) };
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
    const existing = repositories.featureToggles.list({ limit: 10000 }).find((toggle) => toggle.key === payload.key);
    const record = {
      key: payload.key,
      name: payload.name,
      description: payload.description || "",
      scope: payload.scope || "global",
      tenantId: payload.tenantId || "",
      planId: payload.planId || "",
      enabled: payload.enabled ? 1 : 0,
      rules: payload.rules || {}
    };
    const toggle = existing
      ? repositories.featureToggles.update(existing.id, record)
      : repositories.featureToggles.create({ id: makeId("ft"), ...record });
    this.audit(access, existing ? "feature_toggle.updated" : "feature_toggle.created", "feature_toggle", toggle.id, { key: toggle.key, enabled: toggle.enabled });
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
