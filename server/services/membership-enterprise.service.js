import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/app-error.js";
import { realtimeService } from "./realtime.service.js";
import { securityService } from "./security.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {});
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function json(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringify(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

function stableId(prefix, ...parts) {
  const raw = parts.map((part) => JSON.stringify(part ?? "")).join("|");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  return `${prefix}_${Math.abs(hash).toString(36)}`;
}

function addDays(baseDate, days) {
  const date = new Date(baseDate || today());
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function addHoursIso(baseDate, hours) {
  const date = new Date(baseDate || now());
  date.setHours(date.getHours() + Number(hours || 0));
  return date.toISOString();
}

const PAYMENT_MODES = new Set(["cash", "upi", "card", "bank_transfer", "wallet", "credit_due", "credit_note", "no_payment"]);
const COMMISSION_ACTIONS = new Set(["sold", "renew", "upgrade", "downgrade", "cancel"]);
const MEMBERSHIP_LIFECYCLE_ROLES = new Set(["owner", "admin", "superadmin", "manager", "cashier"]);
const MEMBERSHIP_APPROVAL_ROLES = new Set(["owner", "admin", "superadmin", "manager"]);
const SENSITIVE_LIFECYCLE_REQUEST_TYPES = new Set([
  "membership_cancel_approval",
  "membership_refund_credit_note_approval",
  "membership_free_renewal_approval",
  "membership_expiry_extension_approval"
]);
const MANUAL_CREDIT_ADJUSTMENT_REQUEST_TYPE = "membership_manual_credit_adjustment_approval";
const MAX_DIRECT_EXPIRY_EXTENSION_DAYS = 395;
const COMMISSION_RATES = {
  sold: 0.03,
  renew: 0.025,
  upgrade: 0.03,
  downgrade: 0.03,
  cancel: 0.03
};
const MEMBERSHIP_PLAN_TYPES = new Set(["discount", "prepaid_credit", "visit_pack", "service_credit", "combo", "unlimited", "family", "corporate", "tiered"]);

function text(value) {
  return String(value || "").trim();
}

function dateOnly(value) {
  return String(value || today()).slice(0, 10);
}

function dateMs(value) {
  return new Date(`${dateOnly(value)}T00:00:00.000Z`).getTime();
}

function daysBetween(startDate, endDate) {
  const start = dateMs(startDate);
  const end = dateMs(endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(Math.ceil((end - start) / 86400000), 0);
}

function compactPlan(plan = {}) {
  return {
    id: plan.id || "",
    name: plan.name || plan.planName || "Membership",
    price: money(plan.price || 0),
    validityDays: Number(plan.validityDays || 0),
    discountPercent: Number(plan.discountPercent || 0),
    productDiscountPercent: Number(plan.productDiscountPercent || 0)
  };
}

function nextAnnualDate(value) {
  const raw = String(value || "").slice(5, 10);
  if (!/^\d{2}-\d{2}$/.test(raw)) return "";
  const year = Number(today().slice(0, 4));
  const current = `${year}-${raw}`;
  return current >= today() ? current : `${year + 1}-${raw}`;
}

function planTypeFromRules(plan = {}, payload = {}) {
  const rules = plan?.benefitRules && typeof plan.benefitRules === "object" ? plan.benefitRules : {};
  const type = String(payload.planType || plan.planType || rules.planType || (rules.prepaidCredit ? "prepaid_credit" : "discount"));
  return MEMBERSHIP_PLAN_TYPES.has(type) ? type : "discount";
}

function planCreditUnit(planType) {
  if (planType === "prepaid_credit") return "amount";
  if (planType === "visit_pack") return "visit";
  if (planType === "unlimited") return "unlimited";
  return "service";
}

function includedServiceEntries(plan = {}, fallbackCredits = 1) {
  const rows = Array.isArray(plan.includedServices) ? plan.includedServices : [];
  return rows.map((item) => ({
    serviceId: String(item?.serviceId || item?.id || item || ""),
    serviceName: String(item?.serviceName || item?.name || item?.serviceId || item || "Service credit"),
    credits: Math.max(1, Number(item?.credits || fallbackCredits || 1))
  })).filter((item) => item.serviceId || item.serviceName);
}

function planBusinessLabel(plan = {}, planType = planTypeFromRules(plan)) {
  const rules = plan.benefitRules || {};
  const credits = Math.max(0, Number(plan.creditAmount || rules.creditAmount || 0));
  if (planType === "prepaid_credit") return `Pay ₹${Math.round(Number(plan.price || 0)).toLocaleString("en-IN")} / Get ₹${Math.round(credits).toLocaleString("en-IN")} credit`;
  if (planType === "visit_pack") return `${credits || 10} visits`;
  if (planType === "service_credit") return `${credits || 1} service credits`;
  if (planType === "combo") return `${credits || includedServiceEntries(plan).length || 1} combo credits`;
  if (planType === "unlimited") return `Unlimited ${Number(rules.fairUsage?.monthlyCap || 4)} / month`;
  if (planType === "family") return `Family ${Number(rules.family?.memberLimit || 4)} members`;
  if (planType === "corporate") return `Corporate ${rules.corporate?.label || plan.name || ""} ${Number(plan.discountPercent || 0)}%`;
  if (planType === "tiered") return `Tier ${rules.tier?.name || plan.name || ""} after ₹${Math.round(Number(rules.tier?.spendThreshold || 0)).toLocaleString("en-IN")}`;
  return `${Number(plan.discountPercent || 0)}% service discount`;
}

function entitlementTypeFromMembership(membership = {}) {
  const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
  if (history.some((item) => item?.type === "package_sale" || item?.packageId)) return "package";
  if (String(membership.id || "").startsWith("pkgmem_")) return "package";
  if (String(membership.planName || "").trim().toLowerCase().startsWith("package:")) return "package";
  const credits = Array.isArray(membership.serviceCredits) ? membership.serviceCredits : [];
  if (credits.some((item) => item?.packageId)) return "package";
  return "membership";
}

function rowToPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    code: row.code,
    name: row.name,
    description: row.description || "",
    price: Number(row.price || 0),
    validityDays: Number(row.validity_days || 0),
    discountPercent: Number(row.discount_percent || 0),
    productDiscountPercent: Number(row.product_discount_percent || 0),
    gstRate: Number(row.gst_rate || 18),
    includedServices: json(row.included_services_json, []),
    benefitRules: json(row.benefit_rules_json, {}),
    status: row.status || "active",
    active: row.status !== "inactive",
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToLedger(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    clientId: row.client_id,
    membershipId: row.membership_id || "",
    planId: row.plan_id || "",
    invoiceId: row.invoice_id || "",
    saleId: row.sale_id || "",
    action: row.action,
    amount: Number(row.amount || 0),
    paidAmount: Number(row.paid_amount || 0),
    discountAmount: Number(row.discount_amount || 0),
    creditsBefore: Number(row.credits_before || 0),
    creditsAfter: Number(row.credits_after || 0),
    startsOn: row.starts_on || "",
    expiresOn: row.expires_on || "",
    snapshot: json(row.snapshot_json, {}),
    note: row.note || "",
    actorUserId: row.actor_user_id || "",
    createdAt: row.created_at
  };
}

function rowToReminder(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    clientId: row.client_id,
    membershipId: row.membership_id || "",
    planId: row.plan_id || "",
    reminderType: row.reminder_type,
    dueOn: row.due_on || "",
    daysBefore: Number(row.days_before || 0),
    status: row.status || "queued",
    message: row.message || "",
    payload: json(row.payload_json, {}),
    approvedBy: row.approved_by || "",
    sentAt: row.sent_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToAudit(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    actorUserId: row.actor_user_id || "",
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id || "",
    before: json(row.before_json, {}),
    after: json(row.after_json, {}),
    reason: row.reason || "",
    createdAt: row.created_at
  };
}

function rowToSnapshot(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    invoiceId: row.invoice_id || "",
    saleId: row.sale_id || "",
    clientId: row.client_id || "",
    membershipId: row.membership_id || "",
    planId: row.plan_id || "",
    planName: row.plan_name || "",
    discountPercent: Number(row.discount_percent || 0),
    discountAmount: Number(row.discount_amount || 0),
    creditsUsed: Number(row.credits_used || 0),
    terms: json(row.terms_json, {}),
    invoiceTotal: Number(row.invoice_total || 0),
    createdAt: row.created_at
  };
}

function rowToSelfServiceRequest(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id || "",
    clientId: row.client_id || "",
    membershipId: row.membership_id || "",
    requestType: row.request_type,
    status: row.status || "pending",
    reason: row.reason || "",
    token: row.token || "",
    tokenExpiresAt: row.token_expires_at || "",
    requestPayload: json(row.request_payload_json, {}),
    responsePayload: json(row.response_payload_json, {}),
    approvalRequired: Boolean(Number(row.approval_required || 0)),
    requestedBy: row.requested_by || "client",
    requestedAt: row.requested_at || row.created_at,
    reviewedBy: row.reviewed_by || "",
    reviewedRole: row.reviewed_role || "",
    reviewedAt: row.reviewed_at || "",
    rejectionReason: row.rejection_reason || "",
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class MembershipEnterpriseService {
  listPlans(query = {}, access) {
    const branchId = query.branchId ?? access.requestedBranchId ?? "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const rows = db.prepare(
      `SELECT * FROM membership_plans
       WHERE tenant_id = ?
         AND (? = '' OR branch_id = '' OR branch_id = ?)
         AND (? = '' OR status = ?)
       ORDER BY status = 'active' DESC, updated_at DESC`
    ).all(access.tenantId, branchId, branchId, query.status || "", query.status || "");
    return rows.map(rowToPlan);
  }

  getPlan(id, access) {
    const row = db.prepare("SELECT * FROM membership_plans WHERE tenant_id = ? AND id = ?").get(access.tenantId, id);
    if (!row) throw notFound("Membership plan not found");
    if (row.branch_id) tenantService.assertBranchAccess(access, row.branch_id);
    return rowToPlan(row);
  }

  createPlan(payload = {}, access) {
    if (!payload.name) throw badRequest("name is required");
    const branchId = payload.branchId || access.requestedBranchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const code = payload.code || String(payload.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || makeId("plan");
    const id = payload.id || makeId("mplan");
    const stamp = now();
    const row = {
      id,
      tenant_id: access.tenantId,
      branch_id: branchId,
      code,
      name: payload.name,
      description: payload.description || "",
      price: money(payload.price),
      validity_days: Number(payload.validityDays || payload.validity_days || 365),
      discount_percent: Number(payload.discountPercent || payload.discount_percent || 0),
      product_discount_percent: Number(payload.productDiscountPercent || payload.product_discount_percent || 0),
      gst_rate: Number(payload.gstRate || payload.gst_rate || 18),
      included_services_json: stringify(payload.includedServices || payload.included_services || []),
      benefit_rules_json: stringify(payload.benefitRules || payload.benefit_rules || {}),
      status: payload.status || (payload.active === false ? "inactive" : "active"),
      version: 1,
      created_at: stamp,
      updated_at: stamp
    };
    db.prepare(
      `INSERT INTO membership_plans
       (id, tenant_id, branch_id, code, name, description, price, validity_days, discount_percent,
        product_discount_percent, gst_rate, included_services_json, benefit_rules_json, status, version, created_at, updated_at)
       VALUES
       (@id, @tenant_id, @branch_id, @code, @name, @description, @price, @validity_days, @discount_percent,
        @product_discount_percent, @gst_rate, @included_services_json, @benefit_rules_json, @status, @version, @created_at, @updated_at)`
    ).run(row);
    this.audit("membership.plan.created", "membership_plan", id, {}, row, access, branchId);
    realtimeService.broadcast("membership:plan_created", { id, branchId, name: row.name }, { tenantId: access.tenantId, branchId });
    return this.getPlan(id, access);
  }

  updatePlan(id, payload = {}, access) {
    const existing = this.getPlan(id, access);
    if (payload.version && Number(payload.version) !== existing.version) throw conflict("Membership plan was updated by someone else");
    const branchId = payload.branchId ?? existing.branchId;
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const next = {
      branch_id: branchId,
      code: payload.code ?? existing.code,
      name: payload.name ?? existing.name,
      description: payload.description ?? existing.description,
      price: money(payload.price ?? existing.price),
      validity_days: Number(payload.validityDays ?? existing.validityDays),
      discount_percent: Number(payload.discountPercent ?? existing.discountPercent),
      product_discount_percent: Number(payload.productDiscountPercent ?? existing.productDiscountPercent),
      gst_rate: Number(payload.gstRate ?? existing.gstRate),
      included_services_json: stringify(payload.includedServices ?? existing.includedServices, []),
      benefit_rules_json: stringify(payload.benefitRules ?? existing.benefitRules, {}),
      status: payload.status ?? (payload.active === false ? "inactive" : existing.status),
      version: existing.version + 1,
      updated_at: now(),
      id,
      tenant_id: access.tenantId
    };
    db.prepare(
      `UPDATE membership_plans
       SET branch_id = @branch_id, code = @code, name = @name, description = @description,
           price = @price, validity_days = @validity_days, discount_percent = @discount_percent,
           product_discount_percent = @product_discount_percent, gst_rate = @gst_rate,
           included_services_json = @included_services_json, benefit_rules_json = @benefit_rules_json,
           status = @status, version = @version, updated_at = @updated_at
       WHERE tenant_id = @tenant_id AND id = @id`
    ).run(next);
    this.audit("membership.plan.updated", "membership_plan", id, existing, next, access, branchId);
    realtimeService.broadcast("membership:plan_updated", { id, branchId, name: next.name }, { tenantId: access.tenantId, branchId });
    return this.getPlan(id, access);
  }

  planSaleCredits({ plan = {}, payload = {}, planType = "discount" } = {}) {
    const planRules = plan?.benefitRules && typeof plan.benefitRules === "object" ? plan.benefitRules : {};
    const price = money(payload.price ?? plan?.price ?? 0);
    const requestedCredits = Number(payload.planCredits ?? planRules.creditAmount ?? 0);
    const bonusAmount = Number(payload.bonusAmount ?? planRules.bonusAmount ?? 0);
    const prepaidCredits = Math.max(0, Number(requestedCredits || (planType === "prepaid_credit" ? price + bonusAmount : 0)));
    if (Array.isArray(payload.serviceCredits) && payload.serviceCredits.length) {
      return payload.serviceCredits.map((credit) => ({
        ...credit,
        planId: credit.planId || plan?.id || "",
        benefitRules: credit.benefitRules || planRules,
        remaining: Number(credit.remaining ?? credit.credits ?? prepaidCredits ?? 0)
      }));
    }
    if (planType === "prepaid_credit") {
      return [{ type: "prepaid_credit", credits: prepaidCredits, remaining: prepaidCredits, planId: plan?.id || "", bonusAmount, benefitPercent: Number(planRules.benefitPercent || 0), benefitRules: planRules }];
    }
    if (["visit_pack", "service_credit", "combo"].includes(planType)) {
      const credits = Math.max(1, Number(requestedCredits || planRules.creditAmount || 1));
      const included = includedServiceEntries(plan, credits);
      const rows = included.length ? included : [{ serviceId: "", serviceName: plan?.name || "Service credit", credits }];
      return rows.map((row) => ({
        type: planType,
        serviceId: row.serviceId,
        serviceName: row.serviceName,
        credits: row.credits,
        remaining: row.credits,
        planId: plan?.id || "",
        creditUnit: planCreditUnit(planType),
        benefitRules: planRules
      }));
    }
    if (planType === "unlimited") {
      const monthlyCap = Math.max(1, Number(planRules.fairUsage?.monthlyCap || payload.monthlyCap || 4));
      return [{ type: "unlimited_service", credits: monthlyCap, remaining: monthlyCap, planId: plan?.id || "", creditUnit: "unlimited", fairUsage: { monthlyCap }, benefitRules: planRules }];
    }
    return [
      { type: "bill_discount", percent: Number(payload.discountPercent ?? plan?.discountPercent ?? 0), planId: plan?.id || "", benefitRules: planRules },
      ...(Number(plan?.productDiscountPercent || 0) > 0 ? [{ type: "product_discount", percent: Number(plan.productDiscountPercent || 0), planId: plan?.id || "", benefitRules: planRules }] : [])
    ];
  }

  totalCreditsForSale(serviceCredits = [], planType = "discount") {
    if (planType === "discount" || planType === "family" || planType === "corporate" || planType === "tiered") return 0;
    return Math.max(0, serviceCredits.reduce((sum, credit) => sum + Number(credit.remaining ?? credit.credits ?? 0), 0));
  }

  sellMembership(payload = {}, access) {
    if (!payload.clientId) throw badRequest("clientId is required");
    const client = repositories.clients.getById(payload.clientId, scope(access));
    if (!client) throw notFound("Client not found");
    const plan = payload.planId ? this.getPlan(payload.planId, access) : null;
    const branchId = payload.branchId || client.branchId || plan?.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const takenDate = payload.takenDate || today();
    const validityDays = Number(payload.validityDays ?? plan?.validityDays ?? 365);
    const expiresOn = payload.validityDate || addDays(takenDate, validityDays);
    const planName = payload.planName || plan?.name || "Membership";
    const discountPercent = Number(payload.discountPercent ?? plan?.discountPercent ?? 0);
    const planRules = plan?.benefitRules && typeof plan.benefitRules === "object" ? plan.benefitRules : {};
    const planType = planTypeFromRules(plan, payload);
    const serviceCredits = this.planSaleCredits({ plan, payload: { ...payload, discountPercent }, planType });
    const credits = this.totalCreditsForSale(serviceCredits, planType);
    const bonusAmount = Number(payload.bonusAmount ?? (planType === "prepaid_credit" ? planRules.bonusAmount : 0) ?? 0);
    const membership = repositories.memberships.create({
      id: makeId("mem"),
      clientId: payload.clientId,
      planName,
      price: money(payload.price ?? plan?.price ?? 0),
      planCredits: credits,
      creditsRemaining: credits,
      serviceCredits,
      validityDate: expiresOn,
      autoRenew: payload.autoRenew ? 1 : 0,
      loyaltyMultiplier: Number(payload.loyaltyMultiplier || 1),
      status: "active",
      redeemHistory: [{ date: takenDate, type: "membership_sale", planId: plan?.id || "", planType, credits, bonusAmount, invoiceId: payload.invoiceId || "", saleId: payload.saleId || "", businessLabel: planBusinessLabel(plan, planType) }],
      branchId
    }, scope(access));
    this.ledger({
      branchId,
      clientId: payload.clientId,
      membershipId: membership.id,
      planId: plan?.id || "",
      invoiceId: payload.invoiceId || "",
      saleId: payload.saleId || "",
      action: "sold",
      amount: money(payload.price ?? plan?.price ?? 0),
      paidAmount: money(payload.paidAmount ?? payload.price ?? plan?.price ?? 0),
      creditsBefore: 0,
      creditsAfter: credits,
      startsOn: takenDate,
      expiresOn,
      snapshot: {
        plan,
        planType,
        businessLabel: planBusinessLabel(plan, planType),
        membership,
        staffId: payload.staffId || payload.saleStaffId || "",
        staffName: payload.staffName || "",
        commissionSource: "membership_desk"
      },
      note: payload.note || "Membership sold"
    }, access);
    this.audit("membership.sold", "membership", membership.id, {}, {
      ...membership,
      planId: plan?.id || "",
      staffId: payload.staffId || payload.saleStaffId || "",
      commissionSource: "membership_desk"
    }, access, branchId);
    this.scheduleRenewalReminders(membership, plan, access);
    realtimeService.broadcast("membership:sold", { membershipId: membership.id, clientId: payload.clientId, branchId }, { tenantId: access.tenantId, branchId });
    return { membership, eligibility: this.eligibility(payload.clientId, { branchId }, access) };
  }

  eligibility(clientId, query = {}, access) {
    if (!clientId) throw badRequest("clientId is required");
    const client = repositories.clients.getById(clientId, scope(access));
    if (!client) throw notFound("Client not found");
    const branchId = query.branchId || client.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const wallet = this.membershipWallet(clientId, query, access);
    const rows = repositories.memberships.list({ limit: 10000 }, scope(access))
      .filter((item) => item.clientId === clientId || this.familyMemberClientIds(clientId, access).includes(item.clientId));
    const active = rows.filter((item) => item.status !== "expired" && item.status !== "cancelled" && (!item.validityDate || item.validityDate >= today()));
    const expired = rows.filter((item) => item.validityDate && item.validityDate < today());
    const best = active
      .map((membership) => ({
        membership,
        discountPercent: this.discountPercent(membership),
        productDiscountPercent: this.productDiscountPercent(membership),
        creditsLeft: Number(membership.creditsRemaining || 0)
      }))
      .sort((a, b) => b.discountPercent - a.discountPercent || b.creditsLeft - a.creditsLeft)[0];
    const daysLeft = best?.membership?.validityDate ? Math.ceil((new Date(best.membership.validityDate).getTime() - new Date(today()).getTime()) / 86400000) : null;
    const recommendations = [];
    if (!best && Number(client.totalSpend || 0) >= 1000) recommendations.push("Repeat/high spender client ko membership offer karo.");
    if (best && daysLeft !== null && daysLeft <= 30) recommendations.push("Membership renewal due hai, renewal offer WhatsApp queue me bhej sakte hain.");
    if (expired.length && !best) recommendations.push("Expired membership client hai, renewal recovery flow start karo.");
    if (wallet.tierSuggestions?.length) recommendations.push(`${wallet.tierSuggestions[0].tierName || "Next tier"} eligibility ready hai, controlled upgrade action review karo.`);
    if (wallet.fairUsage?.some((item) => item.status === "near_limit")) recommendations.push("Unlimited membership fair-usage cap near hai, front desk ko alert dikhao.");
    if (wallet.occasionBenefits?.length) recommendations.push("Birthday/anniversary benefit configured hai; client date match par free-service reminder bhejo.");
    return {
      clientId,
      branchId,
      discountAllowed: Boolean(wallet.discountAllowed || best?.discountPercent),
      activeMembership: wallet.activeMembership || best?.membership || null,
      bestDiscountPercent: Number(wallet.bestDiscountPercent || best?.discountPercent || 0),
      productDiscountPercent: Number(wallet.productDiscountPercent || best?.productDiscountPercent || 0),
      creditsLeft: Number(wallet.remainingCredits || best?.creditsLeft || 0),
      expiresOn: wallet.expiryDate || best?.membership?.validityDate || "",
      daysLeft,
      renewDue: Boolean(wallet.renewDue || (best && daysLeft !== null && daysLeft <= 30)),
      expiredMemberships: expired,
      allMemberships: rows,
      wallet,
      recommendations,
      explanation: best ? `${best.membership.planName} active hai: ${best.discountPercent}% discount, ${best.creditsLeft} credits.` : "Active membership nahi mila."
    };
  }

  membershipWallet(clientId, query = {}, access) {
    if (!clientId) throw badRequest("clientId is required");
    const client = repositories.clients.getById(clientId, scope(access));
    if (!client) throw notFound("Client not found");
    const branchId = query.branchId || client.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const familyRows = this.familySharingRows(clientId, access);
    const familyClientIds = [...new Set(familyRows.flatMap((row) => [row.primary_client_id, row.member_client_id]).filter(Boolean))];
    const eligibleClientIds = [...new Set([clientId, ...familyClientIds])];
    const memberships = repositories.memberships.list({ limit: 10000 }, scope(access))
      .filter((membership) => eligibleClientIds.includes(membership.clientId))
      .map((membership) => this.membershipWalletSnapshot(membership, clientId, familyRows, access));
    const activeMemberships = memberships.filter((item) => item.isActive);
    const best = activeMemberships
      .sort((a, b) => b.planBenefits.serviceDiscountPercent - a.planBenefits.serviceDiscountPercent || b.serviceCredits.remaining - a.serviceCredits.remaining)[0] || null;
    const walletTransactions = repositories.walletTransactions.list({ limit: 5000 }, scope(access))
      .filter((transaction) => transaction.clientId === clientId)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const latestTransaction = walletTransactions[0] || null;
    const balanceFromTransaction = latestTransaction?.balanceAfter ?? latestTransaction?.balance_after ?? latestTransaction?.balance;
    const walletBalance = balanceFromTransaction !== undefined && balanceFromTransaction !== null && balanceFromTransaction !== ""
      ? money(balanceFromTransaction)
      : money(client.walletBalance || 0);
    const usedCredits = memberships.reduce((sum, item) => sum + item.serviceCredits.used, 0);
    const remainingCredits = activeMemberships.reduce((sum, item) => sum + item.serviceCredits.remaining, 0);
    const activePackages = activeMemberships.filter((item) => item.entitlementType === "package");
    const activePlans = activeMemberships.filter((item) => item.entitlementType !== "package");
    const expiryDate = best?.expiryDate || "";
    const daysLeft = expiryDate ? this.daysLeft(expiryDate) : null;
    const familySharing = {
      enabled: familyRows.length > 0,
      linkedClients: familyClientIds.filter((id) => id !== clientId),
      activeLinks: familyRows.length,
      status: familyRows.length ? "shared" : "not_shared"
    };
    const tierSuggestions = activeMemberships.map((item) => item.tierSuggestion).filter((item) => item?.eligible);
    const fairUsage = activeMemberships
      .filter((item) => Number(item.fairUsage?.monthlyCap || 0) > 0)
      .map((item) => ({ membershipId: item.membershipId, planName: item.planName, ...item.fairUsage }));
    const corporate = activeMemberships.map((item) => item.corporate).filter((item) => item && Object.keys(item).length);
    const occasionBenefits = activeMemberships.map((item) => item.occasionBenefits).filter((item) => item && Object.keys(item).length);
    return {
      clientId,
      clientName: client.name || "",
      branchId,
      activeMembership: best?.membership || null,
      activeMembershipId: best?.membershipId || "",
      activePlanName: best?.planName || "",
      activeBenefitLabel: best?.entitlementType === "package" ? "Active package" : "Active membership",
      planBenefits: best?.planBenefits || null,
      membershipSummary: {
        activeCount: activePlans.length,
        names: activePlans.map((item) => item.planName),
        creditsRemaining: activePlans.reduce((sum, item) => sum + item.serviceCredits.remaining, 0)
      },
      packageSummary: {
        activeCount: activePackages.length,
        names: activePackages.map((item) => item.planName),
        creditsRemaining: activePackages.reduce((sum, item) => sum + item.serviceCredits.remaining, 0)
      },
      serviceCredits: {
        total: activeMemberships.reduce((sum, item) => sum + item.serviceCredits.total, 0),
        used: usedCredits,
        remaining: remainingCredits,
        memberships: activeMemberships.map((item) => ({
          membershipId: item.membershipId,
          entitlementType: item.entitlementType,
          planName: item.planName,
          total: item.serviceCredits.total,
          used: item.serviceCredits.used,
          remaining: item.serviceCredits.remaining
        }))
      },
      productDiscount: Number(best?.planBenefits.productDiscountPercent || 0),
      walletBalance,
      walletConnection: {
        connected: true,
        balance: walletBalance,
        source: latestTransaction ? "wallet_transactions" : "clients.walletBalance",
        latestTransactionId: latestTransaction?.id || "",
        latestTransactionAt: latestTransaction?.createdAt || ""
      },
      usedCredits,
      remainingCredits,
      expiryDate,
      daysLeft,
      autoRenew: Boolean(best?.autoRenew),
      renewDue: Boolean(daysLeft !== null && daysLeft <= 30),
      familySharing,
      fairUsage,
      corporate,
      occasionBenefits,
      tierSuggestions,
      businessLabel: best?.businessLabel || "",
      discountAllowed: Boolean(best?.planBenefits.serviceDiscountPercent),
      bestDiscountPercent: Number(best?.planBenefits.serviceDiscountPercent || 0),
      productDiscountPercent: Number(best?.planBenefits.productDiscountPercent || 0),
      memberships,
      walletTransactions: walletTransactions.slice(0, 10)
    };
  }

  membershipSelfServiceSummary(clientId, query = {}, access) {
    if (!clientId) throw badRequest("clientId is required");
    const client = repositories.clients.getById(clientId, scope(access));
    if (!client) throw notFound("Client not found");
    const branchId = query.branchId || client.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const wallet = this.membershipWallet(clientId, { branchId }, access);
    const activeMemberships = (wallet.memberships || []).filter((membership) => membership.isActive);
    const membershipId = query.membershipId || wallet.activeMembershipId || activeMemberships[0]?.membershipId || "";
    const statusLink = this.selfServiceStatusLinkPreview(clientId, { ...query, branchId }, access);
    const expiryReminders = this.clientExpiryReminders(clientId, branchId, access);
    const requests = this.selfServiceRequests({ clientId, branchId, limit: 50 }, access);
    return {
      client: {
        id: client.id,
        name: client.name || client.fullName || "",
        phone: client.phone || "",
        email: client.email || "",
        branchId
      },
      membershipId,
      statusLink,
      whatsappSummary: this.whatsappMembershipSummaryText(client, wallet, expiryReminders),
      remainingCredits: wallet.remainingCredits || 0,
      expiryDate: wallet.expiryDate || "",
      daysLeft: wallet.daysLeft,
      wallet,
      activeMemberships,
      expiryReminders,
      requests,
      providerReadiness: {
        paymentProviderConfigured: false,
        paymentMethodVaultConfigured: false,
        note: "External payment provider is not configured. Renew/payment-method actions create request records only."
      }
    };
  }

  selfServiceRequests(query = {}, access) {
    const branchId = query.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const rows = db.prepare(
      `SELECT * FROM membership_self_service_requests
       WHERE tenant_id = ?
         AND (? = '' OR branch_id = ?)
         AND (? = '' OR client_id = ?)
         AND (? = '' OR membership_id = ?)
         AND (? = '' OR status = ?)
         AND (? = '' OR request_type = ?)
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(
      access.tenantId,
      branchId, branchId,
      query.clientId || "", query.clientId || "",
      query.membershipId || "", query.membershipId || "",
      query.status || "", query.status || "",
      query.requestType || "", query.requestType || "",
      Math.min(Number(query.limit || 200), 1000)
    );
    return rows.map(rowToSelfServiceRequest);
  }

  createSelfServiceStatusLink(clientId, payload = {}, access) {
    const summary = this.membershipSelfServiceSummary(clientId, payload, access);
    const branchId = payload.branchId || summary.client.branchId || "";
    const token = makeId("mss");
    const tokenExpiresAt = addDays(today(), Number(payload.validityDays || 30));
    const link = this.selfServiceStatusUrl(token, payload);
    const request = this.createMembershipSelfServiceRequest({
      branchId,
      clientId,
      membershipId: payload.membershipId || summary.membershipId || "",
      requestType: "status_link",
      status: "ready",
      reason: payload.reason || "Client membership status link generated",
      token,
      tokenExpiresAt,
      approvalRequired: false,
      requestedBy: payload.requestedBy || access.userId || "staff",
      requestPayload: { link, tokenExpiresAt, channel: payload.channel || "manual" },
      responsePayload: { link, portalReady: true, remainingCredits: summary.remainingCredits, expiryDate: summary.expiryDate }
    }, access);
    return { ...request, link, summary };
  }

  createWhatsAppMembershipSummary(clientId, payload = {}, access) {
    const summary = this.membershipSelfServiceSummary(clientId, payload, access);
    const request = this.createMembershipSelfServiceRequest({
      branchId: summary.client.branchId || payload.branchId || "",
      clientId,
      membershipId: payload.membershipId || summary.membershipId || "",
      requestType: "whatsapp_summary",
      status: "ready",
      reason: payload.reason || "WhatsApp membership summary prepared",
      approvalRequired: false,
      requestedBy: payload.requestedBy || access.userId || "staff",
      requestPayload: { channel: "whatsapp", phone: summary.client.phone || "" },
      responsePayload: { message: summary.whatsappSummary, providerSendReady: false, manualCopyRequired: true }
    }, access);
    return { ...request, message: summary.whatsappSummary, providerSendReady: false };
  }

  createRenewPaymentLink(membershipId, payload = {}, access) {
    const membership = this.getMembershipForSelfService(membershipId, access);
    const quote = this.buildProrationPreview(membership, {
      action: "renew",
      validityDays: payload.validityDays || 365,
      addCredits: payload.addCredits || 0,
      effectiveDate: payload.effectiveDate || today()
    }, access);
    const amount = money(payload.amount ?? payload.payableAmount ?? quote.payableAmount ?? membership.price ?? 0);
    const request = this.createMembershipSelfServiceRequest({
      branchId: membership.branchId || "",
      clientId: membership.clientId,
      membershipId,
      requestType: "renew_payment_link",
      status: "pending_provider",
      reason: payload.reason || "Renew payment link requested",
      approvalRequired: false,
      requestedBy: payload.requestedBy || access.userId || "staff",
      requestPayload: { amount, quote, provider: payload.provider || "not_configured" },
      responsePayload: {
        paymentLinkReady: false,
        paymentProviderConfigured: false,
        placeholder: true,
        message: "Payment provider is not configured. No renewal charge was created."
      }
    }, access);
    return { ...request, amount, paymentLinkReady: false, paymentProviderConfigured: false, quote };
  }

  createCancelRequest(membershipId, payload = {}, access) {
    const membership = this.getMembershipForSelfService(membershipId, access);
    const reason = text(payload.reason || payload.cancelReason);
    if (!reason) throw badRequest("Cancel reason is required");
    const refundAmount = money(payload.refundAmount || payload.creditNoteAmount || 0);
    const request = this.createMembershipSelfServiceRequest({
      branchId: membership.branchId || "",
      clientId: membership.clientId,
      membershipId,
      requestType: "cancel_request",
      status: "pending_approval",
      reason,
      approvalRequired: true,
      requestedBy: payload.requestedBy || "client",
      requestPayload: {
        refundAmount,
        creditNoteAmount: money(payload.creditNoteAmount || refundAmount),
        source: payload.source || "self_service",
        ownerManagerApprovalRequired: true
      },
      responsePayload: { pendingApproval: true, actionApplied: false }
    }, access);
    return request;
  }

  createPaymentMethodUpdateRequest(membershipId, payload = {}, access) {
    const membership = this.getMembershipForSelfService(membershipId, access);
    const request = this.createMembershipSelfServiceRequest({
      branchId: membership.branchId || "",
      clientId: membership.clientId,
      membershipId,
      requestType: "payment_method_update",
      status: "pending_provider",
      reason: payload.reason || payload.note || "Payment method update requested",
      approvalRequired: false,
      requestedBy: payload.requestedBy || "client",
      requestPayload: {
        methodType: payload.methodType || "",
        last4: payload.last4 || "",
        provider: payload.provider || "not_configured"
      },
      responsePayload: {
        paymentMethodUpdated: false,
        paymentProviderConfigured: false,
        placeholder: true,
        message: "Payment method vault is not configured. No card/bank data was stored."
      }
    }, access);
    return request;
  }

  createManualCreditAdjustmentRequest(membershipId, payload = {}, access) {
    this.assertMembershipLifecycleActor(access);
    const membership = this.getMembershipForSelfService(membershipId, access);
    const reason = text(payload.reason || payload.note);
    if (!reason) throw badRequest("Manual credit adjustment reason is required");
    const creditDelta = Number(payload.creditDelta ?? payload.adjustBy ?? 0);
    const requestedCredits = payload.newCredits === undefined || payload.newCredits === null || payload.newCredits === ""
      ? Number(membership.creditsRemaining || 0) + creditDelta
      : Number(payload.newCredits);
    if (!Number.isFinite(requestedCredits) || requestedCredits < 0) throw badRequest("Valid newCredits or creditDelta is required");
    const creditsBefore = Number(membership.creditsRemaining || 0);
    const request = this.createMembershipSelfServiceRequest({
      branchId: membership.branchId || "",
      clientId: membership.clientId,
      membershipId,
      requestType: MANUAL_CREDIT_ADJUSTMENT_REQUEST_TYPE,
      status: "pending_approval",
      reason,
      approvalRequired: true,
      requestedBy: access.userId || "staff",
      requestPayload: {
        controlType: "manual_credit_adjustment",
        creditsBefore,
        creditsAfter: requestedCredits,
        creditDelta: requestedCredits - creditsBefore,
        reason,
        actor: this.membershipActor(access, membership.branchId || "")
      },
      responsePayload: {
        pendingApproval: true,
        actionApplied: false,
        ownerManagerApprovalRequired: true
      }
    }, access);
    this.audit("membership.manual_credit_adjustment.requested", "membership", membershipId, { creditsRemaining: creditsBefore }, request, access, membership.branchId || "");
    return request;
  }

  approveSelfServiceRequest(id, payload = {}, access) {
    this.assertMembershipManager(access);
    const existing = this.getSelfServiceRequestRow(id, access);
    if (existing.branch_id) tenantService.assertBranchAccess(access, existing.branch_id);
    if (!["pending_approval", "pending_provider", "ready", "pending"].includes(existing.status)) throw conflict("Self-service request is already decided");
    let responsePayload = json(existing.response_payload_json, {});
    let actionResult = null;
    if (existing.request_type === "cancel_request") {
      actionResult = this.lifecycle(existing.membership_id, "cancel", {
        confirmed: true,
        paymentMode: "no_payment",
        reason: existing.reason || payload.reason || "Approved self-service cancellation",
        note: `Approved self-service cancellation: ${existing.reason || payload.reason || ""}`,
        refundAmount: json(existing.request_payload_json, {}).refundAmount || 0
      }, access, { approvalBypass: true, approvalRequestId: id });
      responsePayload = { ...responsePayload, actionApplied: true, approvedAction: "membership_cancelled", membership: actionResult.membership };
    } else if (SENSITIVE_LIFECYCLE_REQUEST_TYPES.has(existing.request_type)) {
      const requestPayload = json(existing.request_payload_json, {});
      const lifecycleAction = requestPayload.lifecycleAction || "";
      if (!["renew", "upgrade", "downgrade", "cancel"].includes(lifecycleAction)) throw badRequest("Lifecycle approval request is invalid");
      actionResult = this.lifecycle(existing.membership_id, lifecycleAction, {
        ...(requestPayload.lifecyclePayload || {}),
        approvalRequestId: id,
        approvedBy: access.userId || "",
        approvedRole: access.role || ""
      }, access, { approvalBypass: true, approvalRequestId: id });
      responsePayload = { ...responsePayload, actionApplied: true, approvedAction: `membership_${lifecycleAction}`, membership: actionResult.membership };
    } else if (existing.request_type === MANUAL_CREDIT_ADJUSTMENT_REQUEST_TYPE) {
      actionResult = this.applyManualCreditAdjustment(existing, payload, access);
      responsePayload = { ...responsePayload, actionApplied: true, approvedAction: "manual_credit_adjustment", membership: actionResult.membership };
    } else {
      responsePayload = { ...responsePayload, approved: true, actionApplied: false };
    }
    const stamp = now();
    db.prepare(
      `UPDATE membership_self_service_requests
       SET status = 'approved', reviewed_by = ?, reviewed_role = ?, reviewed_at = ?,
           response_payload_json = ?, version = version + 1, updated_at = ?
       WHERE tenant_id = ? AND id = ?`
    ).run(access.userId || "", access.role || "", stamp, stringify(responsePayload), stamp, access.tenantId, id);
    const updated = rowToSelfServiceRequest(this.getSelfServiceRequestRow(id, access));
    this.audit("membership.self_service.approved", "membership_self_service_request", id, rowToSelfServiceRequest(existing), updated, access, existing.branch_id || "");
    realtimeService.broadcast("membership:self_service_approved", { id, requestType: updated.requestType, membershipId: updated.membershipId }, { tenantId: access.tenantId, branchId: updated.branchId });
    return { ...updated, actionResult };
  }

  rejectSelfServiceRequest(id, payload = {}, access) {
    this.assertMembershipManager(access);
    const existing = this.getSelfServiceRequestRow(id, access);
    if (existing.branch_id) tenantService.assertBranchAccess(access, existing.branch_id);
    if (!["pending_approval", "pending_provider", "ready", "pending"].includes(existing.status)) throw conflict("Self-service request is already decided");
    const rejectionReason = text(payload.rejectionReason || payload.reason);
    if (!rejectionReason) throw badRequest("Rejection reason is required");
    const stamp = now();
    db.prepare(
      `UPDATE membership_self_service_requests
       SET status = 'rejected', reviewed_by = ?, reviewed_role = ?, reviewed_at = ?,
           rejection_reason = ?, response_payload_json = ?, version = version + 1, updated_at = ?
       WHERE tenant_id = ? AND id = ?`
    ).run(access.userId || "", access.role || "", stamp, rejectionReason, stringify({ actionApplied: false, rejectionReason }), stamp, access.tenantId, id);
    const updated = rowToSelfServiceRequest(this.getSelfServiceRequestRow(id, access));
    this.audit("membership.self_service.rejected", "membership_self_service_request", id, rowToSelfServiceRequest(existing), updated, access, existing.branch_id || "");
    realtimeService.broadcast("membership:self_service_rejected", { id, requestType: updated.requestType, membershipId: updated.membershipId }, { tenantId: access.tenantId, branchId: updated.branchId });
    return updated;
  }

  publicSelfServiceStatus(token) {
    const context = this.selfServiceContextForToken(token);
    return {
      ...this.membershipSelfServiceSummary(context.clientId, { branchId: context.branchId, membershipId: context.membershipId }, context.access),
      tokenStatus: {
        token,
        expiresAt: context.request.tokenExpiresAt,
        requestId: context.request.id
      }
    };
  }

  publicRenewPaymentLink(token, payload = {}) {
    const context = this.selfServiceContextForToken(token);
    return this.createRenewPaymentLink(payload.membershipId || context.membershipId, { ...payload, requestedBy: `client:${context.clientId}`, source: "self_service_link" }, context.access);
  }

  publicCancelRequest(token, payload = {}) {
    const context = this.selfServiceContextForToken(token);
    return this.createCancelRequest(payload.membershipId || context.membershipId, { ...payload, requestedBy: `client:${context.clientId}`, source: "self_service_link" }, context.access);
  }

  publicPaymentMethodUpdateRequest(token, payload = {}) {
    const context = this.selfServiceContextForToken(token);
    return this.createPaymentMethodUpdateRequest(payload.membershipId || context.membershipId, { ...payload, requestedBy: `client:${context.clientId}`, source: "self_service_link" }, context.access);
  }

  lifecycle(membershipId, action, payload = {}, access, options = {}) {
    this.assertMembershipLifecycleActor(access);
    const membership = repositories.memberships.getById(membershipId, scope(access));
    if (!membership) throw notFound("Membership not found");
    if (membership.branchId) tenantService.assertBranchAccess(access, membership.branchId);
    const before = { ...membership };
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    let update = {};
    let ledgerAction = action;
    let targetPlan = null;
    if (action === "renew") {
      const base = membership.validityDate && membership.validityDate > today() ? membership.validityDate : today();
      update = {
        status: "active",
        validityDate: payload.validityDate || addDays(base, Number(payload.validityDays || 365)),
        creditsRemaining: Number(membership.creditsRemaining || 0) + Number(payload.addCredits || 0)
      };
    } else if (action === "upgrade" || action === "downgrade") {
      const targetPlanId = payload.planId || payload.targetPlanId;
      if (!targetPlanId) throw badRequest("Target plan is required");
      const plan = this.getPlan(targetPlanId, access);
      targetPlan = plan;
      update = {
        planName: payload.planName || plan?.name || membership.planName,
        price: money(payload.price ?? plan?.price ?? membership.price),
        serviceCredits: payload.serviceCredits || [{ type: "bill_discount", percent: Number(payload.discountPercent ?? plan?.discountPercent ?? this.discountPercent(membership)), planId: plan?.id || "" }],
        validityDate: payload.validityDate || membership.validityDate
      };
      ledgerAction = action;
    } else if (action === "cancel") {
      update = { status: "cancelled" };
    } else {
      throw badRequest("Unsupported membership lifecycle action");
    }
    const payment = this.lifecyclePaymentContext(action, payload, membership, targetPlan, access);
    if ((action === "renew" || action === "upgrade" || action === "downgrade") && payment.quote?.newExpiryDate && !payload.validityDate) {
      update.validityDate = payment.quote.newExpiryDate;
    }
    if ((action === "upgrade" || action === "downgrade") && payment.quote?.creditCarryForward) {
      update.creditsRemaining = Number(payment.quote.creditCarryForward.carryForwardCredits || membership.creditsRemaining || 0);
    }
    const pendingApproval = this.createSensitiveLifecycleApprovalIfRequired(action, membership, targetPlan, payload, payment, update, access, options);
    if (pendingApproval) return pendingApproval;
    const updated = repositories.memberships.update(membershipId, {
      ...update,
      redeemHistory: [{
        date: payment.effectiveDate || today(),
        type: `membership_${action}`,
        note: payload.note || payment.reason || "",
        planId: payload.planId || payload.targetPlanId || "",
        paymentMode: payment.mode,
        referenceNo: payment.referenceNo,
        amount: payment.amount,
        paidAmount: payment.paidAmount,
        refundAmount: payment.refundAmount,
        riskFlags: payment.riskFlags
      }, ...history].slice(0, 100)
    }, scope(access));
    this.ledger({
      branchId: updated.branchId || "",
      clientId: updated.clientId,
      membershipId,
      planId: payload.planId || payload.targetPlanId || "",
      invoiceId: payload.invoiceId || "",
      saleId: payload.saleId || "",
      action: ledgerAction,
      amount: action === "downgrade" ? payment.refundAmount : payment.amount,
      paidAmount: action === "downgrade" ? 0 : payment.paidAmount,
      creditsBefore: Number(membership.creditsRemaining || 0),
      creditsAfter: Number(updated.creditsRemaining || 0),
      startsOn: payment.effectiveDate || today(),
      expiresOn: updated.validityDate || "",
      snapshot: {
        before,
        after: updated,
        payment: {
          mode: payment.mode,
          referenceNo: payment.referenceNo,
          amount: payment.amount,
          paidAmount: payment.paidAmount,
          refundAmount: payment.refundAmount,
          creditNoteAmount: payment.creditNoteAmount,
          effectiveDate: payment.effectiveDate,
          reason: payment.reason,
          zeroReason: payment.zeroReason
        },
        quote: payment.quote,
        riskFlags: payment.riskFlags,
        actor: payment.actor,
        staffId: payload.staffId || payload.saleStaffId || "",
        staffName: payload.staffName || "",
        commissionSource: "membership_lifecycle"
      },
      note: payload.note || payment.reason || `Membership ${action}`
    }, access);
    this.audit(`membership.${action}`, "membership", membershipId, before, updated, access, updated.branchId || "");
    realtimeService.broadcast(`membership:${action}`, { membershipId, clientId: updated.clientId }, { tenantId: access.tenantId, branchId: updated.branchId || "" });
    return { membership: updated, eligibility: this.eligibility(updated.clientId, { branchId: updated.branchId }, access) };
  }

  createSensitiveLifecycleApprovalIfRequired(action, membership, targetPlan, payload = {}, payment = {}, update = {}, access = {}, options = {}) {
    if (options.approvalBypass === true) return null;
    const controls = this.sensitiveLifecycleControls(action, membership, targetPlan, payload, payment, update);
    if (!controls.length) return null;
    const reason = text(payload.reason || payload.zeroReason || payload.note);
    if (!reason) throw badRequest(`Reason is required for ${controls.map((control) => control.label).join(", ")}`);
    const primary = controls[0];
    const request = this.createMembershipSelfServiceRequest({
      branchId: membership.branchId || "",
      clientId: membership.clientId,
      membershipId: membership.id,
      requestType: primary.requestType,
      status: "pending_approval",
      reason,
      approvalRequired: true,
      requestedBy: access.userId || "staff",
      requestPayload: {
        controlType: primary.code,
        controls,
        lifecycleAction: action,
        lifecyclePayload: {
          ...payload,
          confirmed: true,
          reason
        },
        payment,
        plannedUpdate: update,
        targetPlan: targetPlan ? compactPlan(targetPlan) : null,
        actor: this.membershipActor(access, membership.branchId || "")
      },
      responsePayload: {
        pendingApproval: true,
        actionApplied: false,
        ownerManagerApprovalRequired: true,
        message: `${primary.label} requires manager or owner approval before membership changes.`
      }
    }, access);
    this.audit("membership.enterprise_control.pending_approval", "membership", membership.id, membership, request, access, membership.branchId || "");
    return {
      pendingApproval: true,
      approvalRequired: true,
      request,
      controls,
      actionApplied: false,
      membership,
      message: `${primary.label} approval request created. Membership was not changed.`
    };
  }

  sensitiveLifecycleControls(action, membership, targetPlan, payload = {}, payment = {}, update = {}) {
    const controls = [];
    const currentExpiry = membership.validityDate ? dateOnly(membership.validityDate) : "";
    const newExpiry = update.validityDate ? dateOnly(update.validityDate) : "";
    const extensionDays = currentExpiry && newExpiry ? daysBetween(currentExpiry, newExpiry) : Number(payload.validityDays || 0);
    const refundAmount = money(payment.refundAmount || payment.creditNoteAmount || payload.refundAmount || payload.creditNoteAmount || 0);
    const paidAmount = money(payment.paidAmount ?? payload.paidAmount ?? payload.amount ?? 0);
    if (action === "cancel") {
      controls.push({ code: "cancellation", label: "Cancellation", requestType: "membership_cancel_approval", severity: "critical" });
    }
    if (refundAmount > 0) {
      controls.push({ code: "refund_credit_note", label: "Refund/credit note", requestType: "membership_refund_credit_note_approval", amount: refundAmount, severity: "high" });
    }
    if ((action === "renew" || action === "upgrade") && paidAmount <= 0) {
      controls.push({ code: "free_renewal", label: "Free renewal/upgrade", requestType: "membership_free_renewal_approval", amount: paidAmount, severity: "high" });
    }
    if ((action === "renew" || action === "upgrade" || action === "downgrade") && extensionDays > MAX_DIRECT_EXPIRY_EXTENSION_DAYS) {
      controls.push({
        code: "expiry_extension",
        label: "Expiry extension beyond allowed days",
        requestType: "membership_expiry_extension_approval",
        extensionDays,
        allowedDays: MAX_DIRECT_EXPIRY_EXTENSION_DAYS,
        severity: "high"
      });
    }
    if (payload.manualCreditAdjustment === true || payload.creditAdjustment === true) {
      controls.push({ code: "manual_credit_adjustment", label: "Manual credit adjustment", requestType: MANUAL_CREDIT_ADJUSTMENT_REQUEST_TYPE, severity: "high" });
    }
    return controls;
  }

  applyManualCreditAdjustment(existing, payload = {}, access) {
    const requestPayload = json(existing.request_payload_json, {});
    const membership = repositories.memberships.getById(existing.membership_id, scope(access));
    if (!membership) throw notFound("Membership not found");
    if (membership.branchId) tenantService.assertBranchAccess(access, membership.branchId);
    const before = { ...membership };
    const creditsBefore = Number(membership.creditsRemaining || 0);
    const creditsAfter = Math.max(Number(requestPayload.creditsAfter ?? creditsBefore), 0);
    const updated = repositories.memberships.update(membership.id, {
      creditsRemaining: creditsAfter,
      redeemHistory: [{
        date: today(),
        type: "membership_manual_credit_adjustment",
        note: existing.reason || payload.reason || "Approved manual credit adjustment",
        amount: 0,
        paidAmount: 0,
        creditDelta: creditsAfter - creditsBefore,
        approvalRequestId: existing.id
      }, ...(Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [])].slice(0, 100)
    }, scope(access));
    this.ledger({
      branchId: updated.branchId || "",
      clientId: updated.clientId,
      membershipId: updated.id,
      action: "credit_adjustment",
      amount: 0,
      paidAmount: 0,
      creditsBefore,
      creditsAfter,
      startsOn: today(),
      expiresOn: updated.validityDate || "",
      snapshot: {
        before,
        after: updated,
        reason: existing.reason,
        approvalRequestId: existing.id,
        actor: this.membershipActor(access, updated.branchId || "")
      },
      note: existing.reason || "Approved manual credit adjustment"
    }, access);
    this.audit("membership.manual_credit_adjustment.approved", "membership", updated.id, before, updated, access, updated.branchId || "");
    realtimeService.broadcast("membership:credit_adjustment", { membershipId: updated.id, clientId: updated.clientId }, { tenantId: access.tenantId, branchId: updated.branchId || "" });
    return { membership: updated, eligibility: this.eligibility(updated.clientId, { branchId: updated.branchId }, access) };
  }

  addFamilyMember(payload = {}, access) {
    if (!payload.primaryClientId || !payload.memberClientId) throw badRequest("primaryClientId and memberClientId are required");
    const primary = repositories.clients.getById(payload.primaryClientId, scope(access));
    const member = repositories.clients.getById(payload.memberClientId, scope(access));
    if (!primary || !member) throw notFound("Client not found");
    const branchId = payload.branchId || primary.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const row = {
      id: makeId("mfam"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      primary_client_id: payload.primaryClientId,
      member_client_id: payload.memberClientId,
      membership_id: payload.membershipId || "",
      relationship: payload.relationship || "family",
      share_benefits: payload.shareBenefits === false ? 0 : 1,
      status: "active",
      created_at: now(),
      updated_at: now()
    };
    db.prepare(
      `INSERT INTO membership_family_members
       (id, tenant_id, branch_id, primary_client_id, member_client_id, membership_id, relationship, share_benefits, status, created_at, updated_at)
       VALUES (@id, @tenant_id, @branch_id, @primary_client_id, @member_client_id, @membership_id, @relationship, @share_benefits, @status, @created_at, @updated_at)`
    ).run(row);
    this.audit("membership.family.linked", "membership_family", row.id, {}, row, access, branchId);
    return row;
  }

  ledgerList(query = {}, access) {
    const rows = db.prepare(
      `SELECT * FROM client_membership_ledger
       WHERE tenant_id = ?
         AND (? = '' OR branch_id = ?)
         AND (? = '' OR client_id = ?)
         AND (? = '' OR membership_id = ?)
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(access.tenantId, query.branchId || "", query.branchId || "", query.clientId || "", query.clientId || "", query.membershipId || "", query.membershipId || "", Math.min(Number(query.limit || 250), 1000));
    return rows.map(rowToLedger);
  }

  generateReminders(query = {}, access) {
    const rows = repositories.memberships.list({ limit: 10000 }, scope(access, query.branchId || ""))
      .filter((membership) => membership.status !== "cancelled" && membership.validityDate);
    const created = [];
    for (const membership of rows) {
      const client = repositories.clients.getById(membership.clientId, scope(access));
      for (const daysBefore of [30, 15, 7, 1]) {
        const dueOn = addDays(membership.validityDate, -daysBefore);
        if (dueOn < today()) continue;
        const reminder = this.createReminder(membership, null, client, daysBefore, dueOn, access);
        if (reminder) created.push(reminder);
      }
      const snapshot = this.membershipWalletSnapshot(membership, membership.clientId, [], access);
      if (snapshot.serviceCredits.remaining > 0 && snapshot.serviceCredits.remaining <= 2) {
        const reminder = this.createTypedReminder({
          membership,
          plan: this.resolveMembershipPlan(membership, access),
          client,
          reminderType: "low_credits",
          dueOn: today(),
          message: `Hi ${client?.name || "there"}, your ${membership.planName} has only ${snapshot.serviceCredits.remaining} credit(s) left.`,
          payload: { remainingCredits: snapshot.serviceCredits.remaining, planType: snapshot.planType }
        }, access);
        if (reminder) created.push(reminder);
      }
      if (snapshot.fairUsage.monthlyCap && snapshot.fairUsage.status === "near_limit") {
        const reminder = this.createTypedReminder({
          membership,
          plan: this.resolveMembershipPlan(membership, access),
          client,
          reminderType: "fair_usage_near_limit",
          dueOn: today(),
          message: `${membership.planName} fair usage: ${snapshot.fairUsage.monthlyUsed}/${snapshot.fairUsage.monthlyCap} used this month.`,
          payload: snapshot.fairUsage
        }, access);
        if (reminder) created.push(reminder);
      }
      if (snapshot.tierSuggestion?.eligible) {
        const reminder = this.createTypedReminder({
          membership,
          plan: this.resolveMembershipPlan(membership, access),
          client,
          reminderType: "tier_upgrade_eligible",
          dueOn: today(),
          message: `${client?.name || "Client"} is eligible for ${snapshot.tierSuggestion.tierName || "next tier"} membership upgrade.`,
          payload: snapshot.tierSuggestion
        }, access);
        if (reminder) created.push(reminder);
      }
      const occasionRules = snapshot.occasionBenefits || {};
      for (const [reminderType, dateValue] of [
        ["birthday_benefit", occasionRules.birthday ? client?.birthday : ""],
        ["anniversary_benefit", occasionRules.anniversary ? client?.anniversary : ""]
      ]) {
        const dueOn = nextAnnualDate(dateValue);
        if (!dueOn) continue;
        const reminder = this.createTypedReminder({
          membership,
          plan: this.resolveMembershipPlan(membership, access),
          client,
          reminderType,
          dueOn,
          message: `Hi ${client?.name || "there"}, your ${membership.planName} ${reminderType.replace("_", " ")} is available on ${dueOn}.`,
          payload: { occasionDate: dueOn, benefit: reminderType }
        }, access);
        if (reminder) created.push(reminder);
      }
    }
    return { created, count: created.length };
  }

  reminders(query = {}, access) {
    const rows = db.prepare(
      `SELECT * FROM membership_whatsapp_reminders
       WHERE tenant_id = ?
         AND (? = '' OR branch_id = ?)
         AND (? = '' OR status = ?)
       ORDER BY due_on ASC, created_at DESC
       LIMIT ?`
    ).all(access.tenantId, query.branchId || "", query.branchId || "", query.status || "", query.status || "", Math.min(Number(query.limit || 200), 1000));
    return rows.map(rowToReminder);
  }

  approveReminder(id, access) {
    const existing = db.prepare("SELECT * FROM membership_whatsapp_reminders WHERE tenant_id = ? AND id = ?").get(access.tenantId, id);
    if (!existing) throw notFound("Reminder not found");
    if (existing.branch_id) tenantService.assertBranchAccess(access, existing.branch_id);
    db.prepare(
      `UPDATE membership_whatsapp_reminders
       SET status = 'approved', approved_by = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`
    ).run(access.userId || "", now(), access.tenantId, id);
    const row = db.prepare("SELECT * FROM membership_whatsapp_reminders WHERE tenant_id = ? AND id = ?").get(access.tenantId, id);
    this.audit("membership.reminder.approved", "membership_whatsapp_reminder", id, existing, row, access, existing.branch_id || "");
    return rowToReminder(row);
  }

  autoRenewQueue(query = {}, access) {
    const branchId = query.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const rows = repositories.memberships.list({ limit: 10000 }, scope(access, branchId))
      .filter((membership) => membership.status !== "cancelled" && membership.validityDate)
      .map((membership) => this.autoRenewQueueItem(membership, access))
      .filter((item) => item.autoRenewEnabled || item.failedPayment || item.paused || item.daysLeft <= 7)
      .sort((a, b) => a.sortScore - b.sortScore || String(a.expiresOn).localeCompare(String(b.expiresOn)));
    const limited = rows.slice(0, Math.min(Number(query.limit || 200), 1000));
    return {
      metrics: {
        total: rows.length,
        dueToday: rows.filter((item) => item.bucket === "due_today").length,
        dueIn7Days: rows.filter((item) => item.bucket === "due_in_7_days").length,
        failedPayment: rows.filter((item) => item.failedPayment).length,
        paused: rows.filter((item) => item.paused).length,
        paymentMethodMissing: rows.filter((item) => item.paymentMethod.status === "missing").length
      },
      items: limited
    };
  }

  retryAutoRenew(membershipId, payload = {}, access) {
    const membership = repositories.memberships.getById(membershipId, scope(access));
    if (!membership) throw notFound("Membership not found");
    if (membership.branchId) tenantService.assertBranchAccess(access, membership.branchId);
    const client = repositories.clients.getById(membership.clientId, scope(access));
    const plan = this.resolveMembershipPlan(membership, access);
    const before = this.autoRenewQueueItem(membership, access);
    const retryCount = before.retryCount + 1;
    const paymentMethod = this.autoRenewPaymentMethod(membership, client, plan, payload);
    const providerReady = payload.providerReady === true || payload.paymentProviderReady === true;
    let failureReason = "";
    if (!Number(membership.autoRenew || 0)) {
      failureReason = "auto_renew_paused";
    } else if (paymentMethod.status === "missing") {
      failureReason = "payment_method_missing";
    } else if (!providerReady) {
      failureReason = "payment_provider_not_ready";
    }
    const nextRetryAt = addHoursIso(now(), retryCount >= 3 ? 24 : 2);
    const reminder = failureReason
      ? this.createAutoRenewReminder(membership, client, plan, failureReason, nextRetryAt, access)
      : this.createAutoRenewReminder(membership, client, plan, "provider_confirmation_required", nextRetryAt, access);
    const after = {
      status: failureReason ? "failed" : "pending_provider_confirmation",
      failureReason: failureReason || "provider_confirmation_required",
      retryCount,
      nextRetryAt,
      paymentMethod,
      paymentProviderReady: providerReady,
      reminderId: reminder?.id || "",
      note: payload.note || "Manual auto-renew retry requested"
    };
    this.audit("membership.auto_renew.retry_failed", "membership", membershipId, before, after, access, membership.branchId || "");
    realtimeService.broadcast("membership:auto_renew_retry_failed", { membershipId, clientId: membership.clientId, failureReason: after.failureReason }, { tenantId: access.tenantId, branchId: membership.branchId || "" });
    return { item: this.autoRenewQueueItem(membership, access), retry: after, reminder };
  }

  pauseAutoRenew(membershipId, payload = {}, access) {
    const membership = repositories.memberships.getById(membershipId, scope(access));
    if (!membership) throw notFound("Membership not found");
    if (membership.branchId) tenantService.assertBranchAccess(access, membership.branchId);
    const before = { ...membership, queue: this.autoRenewQueueItem(membership, access) };
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const updated = repositories.memberships.update(membershipId, {
      autoRenew: 0,
      redeemHistory: [{
        date: today(),
        type: "membership_auto_renew_paused",
        note: payload.reason || payload.note || "Auto-renew paused from membership desk"
      }, ...history].slice(0, 100)
    }, scope(access));
    this.audit("membership.auto_renew.paused", "membership", membershipId, before, updated, access, updated.branchId || "");
    return { membership: updated, item: this.autoRenewQueueItem(updated, access) };
  }

  resumeAutoRenew(membershipId, payload = {}, access) {
    const membership = repositories.memberships.getById(membershipId, scope(access));
    if (!membership) throw notFound("Membership not found");
    if (membership.branchId) tenantService.assertBranchAccess(access, membership.branchId);
    const before = { ...membership, queue: this.autoRenewQueueItem(membership, access) };
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const updated = repositories.memberships.update(membershipId, {
      autoRenew: 1,
      redeemHistory: [{
        date: today(),
        type: "membership_auto_renew_resumed",
        note: payload.note || "Auto-renew resumed from membership desk"
      }, ...history].slice(0, 100)
    }, scope(access));
    this.audit("membership.auto_renew.resumed", "membership", membershipId, before, updated, access, updated.branchId || "");
    const client = repositories.clients.getById(updated.clientId, scope(access));
    const plan = this.resolveMembershipPlan(updated, access);
    const paymentMethod = this.autoRenewPaymentMethod(updated, client, plan, payload);
    let reminder = null;
    if (paymentMethod.status === "missing") {
      reminder = this.createAutoRenewReminder(updated, client, plan, "payment_method_missing", now(), access);
    }
    return { membership: updated, item: this.autoRenewQueueItem(updated, access), reminder };
  }

  revenueReport(query = {}, access) {
    const branchId = query.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const memberships = repositories.memberships.list({ limit: 10000 }, scope(access, branchId));
    const ledger = this.ledgerList({ branchId, limit: 1000 }, access);
    const snapshots = db.prepare(
      `SELECT * FROM membership_invoice_snapshots
       WHERE tenant_id = ? AND (? = '' OR branch_id = ?)`
    ).all(access.tenantId, branchId, branchId);
    const active = memberships.filter((item) => item.status === "active" && (!item.validityDate || item.validityDate >= today()));
    const expired = memberships.filter((item) => item.validityDate && item.validityDate < today());
    const totalMembers = new Set(memberships.map((item) => item.clientId).filter(Boolean)).size;
    const activeMembers = new Set(active.map((item) => item.clientId).filter(Boolean)).size;
    const soldRevenue = ledger.filter((item) => ["sold", "renew", "upgrade"].includes(item.action)).reduce((sum, item) => sum + Number(item.paidAmount || item.amount || 0), 0);
    const redeemedDiscount = snapshots.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);
    const creditsRemaining = memberships.reduce((sum, item) => sum + Number(item.creditsRemaining || 0), 0);
    const pendingLiability = memberships.reduce((sum, item) => sum + Number(item.creditsRemaining || 0) * 500, 0);
    const renewalRate = memberships.length ? Math.round((ledger.filter((item) => item.action === "renew").length / memberships.length) * 1000) / 10 : 0;
    return {
      metrics: {
        totalMemberships: memberships.length,
        totalMembers,
        active: active.length,
        activeMembers,
        expired: expired.length,
        soldRevenue: money(soldRevenue),
        redeemedDiscount: money(redeemedDiscount),
        pendingLiability: money(pendingLiability),
        creditsRemaining,
        renewalRate
      },
      expiringSoon: active.filter((item) => item.validityDate && this.daysLeft(item.validityDate) <= 30),
      ledger: ledger.slice(0, 50),
      snapshots: snapshots.slice(0, 50)
    };
  }

  membershipCommissionReport(query = {}, access) {
    const branchId = query.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const staffFilter = text(query.staffId || "");
    const actionFilter = text(query.action || "");
    const fromDate = text(query.fromDate || query.startDate || "");
    const toDate = text(query.toDate || query.endDate || "");
    const maxRows = Math.min(Number(query.limit || 1000), 1000);
    const rawLedger = this.ledgerList({ branchId, limit: 1000 }, access)
      .filter((row) => COMMISSION_ACTIONS.has(row.action))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const auditRows = db.prepare(
      `SELECT * FROM membership_audit_logs
       WHERE tenant_id = ?
         AND (? = '' OR branch_id = ?)
         AND target_type = 'membership'
         AND action LIKE 'membership.%'
       ORDER BY created_at DESC
       LIMIT 1000`
    ).all(access.tenantId, branchId, branchId).map(rowToAudit);
    const auditKeys = new Set(auditRows.map((row) => `${row.targetId}:${row.action}`));
    const seen = new Set();
    const priorCommissionByMembership = new Map();
    const staffRows = new Map();
    const entries = [];
    let doubleCountGuardedRows = 0;

    const ensureStaff = (actor) => {
      const key = actor.userId || actor.label || "system";
      if (!staffRows.has(key)) {
        staffRows.set(key, {
          staffId: actor.userId || "",
          staffName: actor.name || actor.label || "System",
          role: actor.role || "",
          saleRevenue: 0,
          renewalRevenue: 0,
          upgradeRevenue: 0,
          cancellationImpact: 0,
          commissionPreview: 0,
          saleCount: 0,
          renewalCount: 0,
          upgradeCount: 0,
          cancellationCount: 0,
          reversalFlags: 0,
          handledClients: new Set(),
          retainedClients: new Set()
        });
      }
      return staffRows.get(key);
    };

    for (const row of rawLedger) {
      const dedupeKey = this.membershipCommissionDedupeKey(row);
      if (seen.has(dedupeKey)) {
        doubleCountGuardedRows += 1;
        continue;
      }
      seen.add(dedupeKey);
      const actor = this.membershipCommissionActor(row, access);
      const eventDate = dateOnly(row.createdAt || "");
      const includeInReport = (!staffFilter || actor.userId === staffFilter)
        && (!actionFilter || row.action === actionFilter)
        && (!fromDate || eventDate >= fromDate)
        && (!toDate || eventDate <= toDate);

      const rate = COMMISSION_RATES[row.action] || 0;
      const revenue = this.membershipCommissionRevenue(row);
      const priorCommission = money(priorCommissionByMembership.get(row.membershipId) || 0);
      const positiveCommission = ["sold", "renew", "upgrade"].includes(row.action) ? money(Math.max(revenue, 0) * rate) : 0;
      let commissionImpact = positiveCommission;
      let status = positiveCommission > 0 ? "preview" : "risk_flagged";
      let reversalReason = "";
      if (row.action === "downgrade" || row.action === "cancel") {
        const refundValue = Math.abs(revenue) || this.membershipCommissionRefundValue(row);
        const fallbackImpact = money(refundValue * rate);
        const reversalImpact = priorCommission > 0 ? Math.min(priorCommission, fallbackImpact || priorCommission) : fallbackImpact;
        commissionImpact = money(-Math.abs(reversalImpact));
        status = "reversal_flagged";
        reversalReason = row.action === "cancel"
          ? "Membership cancellation should reverse or manager-review previously earned commission."
          : "Downgrade refund/credit note should adjust membership commission.";
      }
      if (["sold", "renew", "upgrade"].includes(row.action)) {
        priorCommissionByMembership.set(row.membershipId, money(priorCommission + commissionImpact));
      } else if (row.action === "downgrade" || row.action === "cancel") {
        priorCommissionByMembership.set(row.membershipId, Math.max(money(priorCommission + commissionImpact), 0));
      }
      if (!includeInReport) continue;

      const auditAction = `membership.${row.action}`;
      const auditStatus = auditKeys.has(`${row.membershipId}:${auditAction}`) ? "logged" : "missing";
      const entry = {
        id: row.id,
        dedupeKey,
        membershipId: row.membershipId,
        clientId: row.clientId,
        planId: row.planId,
        invoiceId: row.invoiceId,
        action: row.action,
        staffId: actor.userId,
        staffName: actor.name || actor.label || "System",
        role: actor.role || "",
        revenue: money(revenue),
        commissionRate: rate,
        commissionPreview: money(Math.max(commissionImpact, 0)),
        commissionImpact,
        status,
        reversalReason,
        auditStatus,
        auditRequired: auditStatus !== "logged",
        paymentMode: row.snapshot?.payment?.mode || "",
        referenceNo: row.snapshot?.payment?.referenceNo || "",
        note: row.note || "",
        createdAt: row.createdAt
      };
      entries.push(entry);

      const staff = ensureStaff(actor);
      staff.handledClients.add(row.clientId || row.membershipId || row.id);
      if (row.action === "sold") {
        staff.saleRevenue = money(staff.saleRevenue + Math.max(revenue, 0));
        staff.saleCount += 1;
      } else if (row.action === "renew") {
        staff.renewalRevenue = money(staff.renewalRevenue + Math.max(revenue, 0));
        staff.renewalCount += 1;
        staff.retainedClients.add(row.clientId || row.membershipId);
      } else if (row.action === "upgrade") {
        staff.upgradeRevenue = money(staff.upgradeRevenue + Math.max(revenue, 0));
        staff.upgradeCount += 1;
        staff.retainedClients.add(row.clientId || row.membershipId);
      } else if (row.action === "downgrade" || row.action === "cancel") {
        staff.cancellationImpact = money(staff.cancellationImpact + commissionImpact);
        staff.cancellationCount += 1;
        staff.reversalFlags += 1;
      }
      staff.commissionPreview = money(staff.commissionPreview + commissionImpact);
    }

    const visibleEntries = entries
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, maxRows);
    const staff = [...staffRows.values()].map((row) => {
      const handledClients = row.handledClients.size;
      const retainedClients = row.retainedClients.size;
      return {
        staffId: row.staffId,
        staffName: row.staffName,
        role: row.role,
        saleRevenue: row.saleRevenue,
        renewalRevenue: row.renewalRevenue,
        upgradeRevenue: row.upgradeRevenue,
        cancellationImpact: row.cancellationImpact,
        commissionPreview: row.commissionPreview,
        saleCount: row.saleCount,
        renewalCount: row.renewalCount,
        upgradeCount: row.upgradeCount,
        cancellationCount: row.cancellationCount,
        reversalFlags: row.reversalFlags,
        handledClients,
        retainedClients,
        retentionRate: handledClients ? Math.round((retainedClients / handledClients) * 1000) / 10 : 0,
        effectiveRate: (row.saleRevenue + row.renewalRevenue + row.upgradeRevenue) > 0
          ? Math.round((Math.max(row.commissionPreview, 0) / (row.saleRevenue + row.renewalRevenue + row.upgradeRevenue)) * 1000) / 10
          : 0
      };
    }).sort((a, b) => b.commissionPreview - a.commissionPreview || b.renewalRevenue - a.renewalRevenue);
    const metrics = {
      totalRevenue: money(visibleEntries.reduce((sum, row) => sum + Math.max(Number(row.revenue || 0), 0), 0)),
      saleRevenue: money(visibleEntries.filter((row) => row.action === "sold").reduce((sum, row) => sum + Number(row.revenue || 0), 0)),
      renewalRevenue: money(visibleEntries.filter((row) => row.action === "renew").reduce((sum, row) => sum + Number(row.revenue || 0), 0)),
      upgradeRevenue: money(visibleEntries.filter((row) => row.action === "upgrade").reduce((sum, row) => sum + Number(row.revenue || 0), 0)),
      cancellationImpact: money(visibleEntries.filter((row) => row.action === "cancel" || row.action === "downgrade").reduce((sum, row) => sum + Number(row.commissionImpact || 0), 0)),
      commissionPreview: money(visibleEntries.reduce((sum, row) => sum + Number(row.commissionImpact || 0), 0)),
      staffCount: staff.length,
      doubleCountGuardedRows,
      auditMissing: visibleEntries.filter((row) => row.auditRequired).length
    };
    return {
      metrics,
      staff,
      entries: visibleEntries,
      staffMembershipSales: staff.map((row) => ({ staffId: row.staffId, staffName: row.staffName, revenue: row.saleRevenue, count: row.saleCount, commissionPreview: money(row.saleRevenue * COMMISSION_RATES.sold) })),
      renewalRevenueByStaff: staff.map((row) => ({ staffId: row.staffId, staffName: row.staffName, revenue: row.renewalRevenue, count: row.renewalCount })),
      upgradeRevenueByStaff: staff.map((row) => ({ staffId: row.staffId, staffName: row.staffName, revenue: row.upgradeRevenue, count: row.upgradeCount })),
      cancellationImpact: visibleEntries.filter((row) => row.action === "cancel" || row.action === "downgrade"),
      commissionPreviewIntegration: {
        source: "client_membership_ledger",
        guard: "one commission row per ledger id",
        reportRoute: "/reports/commission-preview"
      }
    };
  }

  membershipCommissionDedupeKey(row = {}) {
    return row.id || [row.membershipId, row.invoiceId, row.saleId, row.action, row.createdAt].filter(Boolean).join(":");
  }

  membershipCommissionActor(row = {}, access) {
    const snapshot = row.snapshot || {};
    const explicitStaffId = snapshot.staffId || snapshot.staff_id || snapshot.saleStaffId || snapshot.sourceItem?.staffId || snapshot.sourceItem?.staff_id || snapshot.membership?.staffId || snapshot.membership?.staff_id || "";
    if (explicitStaffId) {
      const actor = this.resolveActor(explicitStaffId, access);
      if (snapshot.staffName && (!actor.name || actor.name === explicitStaffId)) actor.name = snapshot.staffName;
      actor.label = actor.name || actor.label || explicitStaffId;
      return actor;
    }
    return this.resolveActor(snapshot.actor?.userId || row.actorUserId || "", access);
  }

  membershipCommissionRevenue(row = {}) {
    if (row.action === "downgrade" || row.action === "cancel") {
      return money(-this.membershipCommissionRefundValue(row));
    }
    return money(row.paidAmount || row.amount || row.snapshot?.payment?.paidAmount || row.snapshot?.payment?.amount || 0);
  }

  membershipCommissionRefundValue(row = {}) {
    const payment = row.snapshot?.payment || {};
    return money(Math.abs(Number(payment.refundAmount || payment.creditNoteAmount || row.amount || 0)));
  }

  membershipRiskReport(query = {}, access) {
    const branchId = query.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const riskFilter = text(query.riskLevel || "");
    const reviewFilter = text(query.reviewStatus || "");
    const ledger = this.ledgerList({ branchId, limit: 1000 }, access);
    const memberships = repositories.memberships.list({ limit: 10000 }, scope(access, branchId));
    const membershipById = new Map(memberships.map((membership) => [membership.id, membership]));
    const snapshots = db.prepare(
      `SELECT * FROM membership_invoice_snapshots
       WHERE tenant_id = ? AND (? = '' OR branch_id = ?)
       ORDER BY created_at DESC
       LIMIT 1000`
    ).all(access.tenantId, branchId, branchId).map(rowToSnapshot);
    const reviewState = this.membershipRiskReviewState(access);
    const signals = [];
    const addSignal = (code, level, score, reasons, evidence, suggestedAction, context = {}) => {
      const id = stableId("mrisk", code, context.membershipId, context.staffId, context.clientId, evidence?.id || evidence?.createdAt || evidence);
      const reviewed = reviewState.get(id);
      signals.push({
        id,
        code,
        riskLevel: level,
        riskScore: Math.max(0, Math.min(Number(score || 0), 100)),
        reasons: Array.isArray(reasons) ? reasons : [reasons].filter(Boolean),
        reason: Array.isArray(reasons) ? reasons.join(" ") : String(reasons || ""),
        evidence,
        suggestedAction,
        reviewStatus: reviewed?.reviewStatus || "pending",
        reviewedBy: reviewed?.actorUserId || "",
        reviewedAt: reviewed?.createdAt || "",
        branchId: context.branchId || evidence?.branchId || "",
        membershipId: context.membershipId || evidence?.membershipId || "",
        clientId: context.clientId || evidence?.clientId || "",
        staffId: context.staffId || "",
        staffName: context.staffName || "",
        createdAt: context.createdAt || evidence?.createdAt || now()
      });
    };

    for (const row of ledger.filter((item) => item.action === "renew")) {
      const paidAmount = Number(row.paidAmount || 0);
      const amount = Number(row.amount || 0);
      const actor = this.membershipCommissionActor(row, access);
      if (amount <= 0 && paidAmount <= 0) {
        addSignal(
          "free_renewal_alert",
          "critical",
          95,
          ["Free renewal detected with zero amount and zero paid amount."],
          row,
          "Verify approval, reason, and owner authorization before commission or benefit extension.",
          { membershipId: row.membershipId, clientId: row.clientId, staffId: actor.userId, staffName: actor.name, createdAt: row.createdAt, branchId: row.branchId }
        );
      } else if (paidAmount <= 0) {
        addSignal(
          "zero_paid_renewal",
          "high",
          88,
          ["Renewal has payable amount but paid amount is zero."],
          row,
          "Collect payment or move renewal to approved due/credit workflow.",
          { membershipId: row.membershipId, clientId: row.clientId, staffId: actor.userId, staffName: actor.name, createdAt: row.createdAt, branchId: row.branchId }
        );
      }
      const referenceNo = text(row.snapshot?.payment?.referenceNo);
      const paymentMode = text(row.snapshot?.payment?.mode);
      if (paidAmount > 0 && !referenceNo && !["cash", "wallet"].includes(paymentMode)) {
        addSignal(
          "renewal_without_payment_reference",
          "medium",
          68,
          ["Renewal payment has no reference number."],
          row,
          "Attach UPI/card/bank reference or cashier approval note.",
          { membershipId: row.membershipId, clientId: row.clientId, staffId: actor.userId, staffName: actor.name, createdAt: row.createdAt, branchId: row.branchId }
        );
      }
    }

    const cancellationsByStaff = new Map();
    for (const row of ledger.filter((item) => item.action === "cancel")) {
      const actor = this.membershipCommissionActor(row, access);
      const key = actor.userId || actor.label || "system";
      const bucket = cancellationsByStaff.get(key) || { actor, rows: [] };
      bucket.rows.push(row);
      cancellationsByStaff.set(key, bucket);
    }
    for (const bucket of cancellationsByStaff.values()) {
      if (bucket.rows.length >= 3) {
        addSignal(
          "repeated_cancellation_by_staff",
          bucket.rows.length >= 5 ? "critical" : "high",
          bucket.rows.length >= 5 ? 96 : 84,
          [`Same staff handled ${bucket.rows.length} membership cancellations.`],
          bucket.rows.slice(0, 10),
          "Review cancellation reasons, client calls, refunds, and staff permissions.",
          { staffId: bucket.actor.userId, staffName: bucket.actor.name, createdAt: bucket.rows.at(-1)?.createdAt || now(), branchId: bucket.rows[0]?.branchId || "" }
        );
      }
    }

    for (const row of ledger.filter((item) => ["renew", "upgrade"].includes(item.action))) {
      const beforeExpiry = row.snapshot?.before?.validityDate;
      const afterExpiry = row.snapshot?.after?.validityDate || row.expiresOn;
      if (!beforeExpiry || !afterExpiry) continue;
      const extensionDays = daysBetween(beforeExpiry, afterExpiry);
      const expectedDays = Number(row.snapshot?.quote?.targetPlan?.validityDays || row.snapshot?.quote?.validityDays || 365);
      if (extensionDays > Math.max(expectedDays + 45, 430)) {
        const actor = this.membershipCommissionActor(row, access);
        addSignal(
          "manual_expiry_extended_unusually",
          extensionDays > 730 ? "critical" : "high",
          extensionDays > 730 ? 94 : 82,
          [`Membership expiry extended by ${extensionDays} days, above expected ${expectedDays} days.`],
          { ...row, extensionDays, beforeExpiry, afterExpiry, expectedDays },
          "Check manual expiry override and owner approval.",
          { membershipId: row.membershipId, clientId: row.clientId, staffId: actor.userId, staffName: actor.name, createdAt: row.createdAt, branchId: row.branchId }
        );
      }
    }

    const discountByMembership = new Map();
    for (const snapshot of snapshots) {
      const membership = membershipById.get(snapshot.membershipId);
      const discountPercent = Number(snapshot.discountPercent || 0);
      const discountAmount = Number(snapshot.discountAmount || 0);
      if (discountAmount > 1500 || discountPercent > 50) {
        addSignal(
          "high_discount_misuse",
          discountAmount > 3000 || discountPercent > 75 ? "critical" : "high",
          discountAmount > 3000 || discountPercent > 75 ? 92 : 80,
          [`High membership discount applied: ${discountPercent}% / ₹${discountAmount}.`],
          snapshot,
          "Compare discount against plan rules and invoice approval.",
          { membershipId: snapshot.membershipId, clientId: snapshot.clientId, createdAt: snapshot.createdAt, branchId: snapshot.branchId }
        );
      }
      const key = snapshot.membershipId || snapshot.clientId;
      const bucket = discountByMembership.get(key) || { snapshots: [], totalDiscount: 0 };
      bucket.snapshots.push(snapshot);
      bucket.totalDiscount += discountAmount;
      discountByMembership.set(key, bucket);
      if (membership?.validityDate && dateOnly(snapshot.createdAt) > dateOnly(membership.validityDate)) {
        addSignal(
          "membership_used_after_expiry",
          "critical",
          98,
          ["Membership benefit used after expiry date."],
          { snapshot, expiryDate: membership.validityDate },
          "Reverse benefit or approve exception with manager note.",
          { membershipId: snapshot.membershipId, clientId: snapshot.clientId, createdAt: snapshot.createdAt, branchId: snapshot.branchId }
        );
      }
    }
    for (const [key, bucket] of discountByMembership.entries()) {
      if (bucket.snapshots.length >= 5 && bucket.totalDiscount >= 3000) {
        addSignal(
          "high_discount_misuse",
          "medium",
          72,
          [`Membership/client has ${bucket.snapshots.length} discount uses worth ₹${money(bucket.totalDiscount)}.`],
          bucket.snapshots.slice(0, 10),
          "Review repeated benefit usage against fair-use policy.",
          { membershipId: key, clientId: bucket.snapshots[0]?.clientId || "", createdAt: bucket.snapshots[0]?.createdAt || now(), branchId: bucket.snapshots[0]?.branchId || "" }
        );
      }
    }

    const rowsByMembership = new Map();
    for (const row of ledger) {
      const bucket = rowsByMembership.get(row.membershipId) || [];
      bucket.push(row);
      rowsByMembership.set(row.membershipId, bucket);
    }
    for (const [membershipId, rows] of rowsByMembership.entries()) {
      const sorted = rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      const sale = sorted.find((row) => row.action === "sold");
      const downgrade = sorted.find((row) => row.action === "downgrade");
      if (sale && downgrade && daysBetween(sale.createdAt, downgrade.createdAt) <= 7) {
        const actor = this.membershipCommissionActor(downgrade, access);
        addSignal(
          "downgrade_immediately_after_sale",
          "high",
          86,
          ["Membership downgraded within 7 days of sale."],
          { sale, downgrade },
          "Review sale promise, refund approval, and staff incentive impact.",
          { membershipId, clientId: downgrade.clientId || sale.clientId, staffId: actor.userId, staffName: actor.name, createdAt: downgrade.createdAt, branchId: downgrade.branchId || sale.branchId }
        );
      }
      const refunds = sorted.filter((row) => row.action === "downgrade" && this.membershipCommissionRefundValue(row) > 0);
      const refundTotal = refunds.reduce((sum, row) => sum + this.membershipCommissionRefundValue(row), 0);
      if (refunds.length >= 2 || refundTotal >= 3000) {
        const actor = this.membershipCommissionActor(refunds[0], access);
        addSignal(
          "refund_credit_note_abuse",
          refundTotal >= 5000 ? "critical" : "high",
          refundTotal >= 5000 ? 93 : 82,
          [`Refund/credit note value ₹${money(refundTotal)} across ${refunds.length} downgrade event(s).`],
          refunds,
          "Require manager approval and reconcile credit notes with payment ledger.",
          { membershipId, clientId: refunds[0]?.clientId || "", staffId: actor.userId, staffName: actor.name, createdAt: refunds[0]?.createdAt || now(), branchId: refunds[0]?.branchId || "" }
        );
      }
    }

    for (const membership of memberships) {
      const planCredits = Number(membership.planCredits || 0);
      const remaining = Number(membership.creditsRemaining || 0);
      if (remaining < 0 || (planCredits > 0 && remaining > planCredits)) {
        addSignal(
          "credits_mismatch",
          remaining < 0 ? "critical" : "high",
          remaining < 0 ? 95 : 84,
          [`Credits mismatch: remaining ${remaining}, plan credits ${planCredits}.`],
          membership,
          "Recalculate credits from membership ledger before next redemption.",
          { membershipId: membership.id, clientId: membership.clientId, createdAt: membership.updatedAt || membership.createdAt || now(), branchId: membership.branchId || "" }
        );
      }
    }

    const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
    const filtered = signals
      .map((signal) => ({ ...signal, riskRank: this.riskRank(signal.riskLevel) }))
      .filter((signal) => !riskFilter || signal.riskLevel === riskFilter)
      .filter((signal) => !reviewFilter || signal.reviewStatus === reviewFilter)
      .sort((a, b) => b.riskRank - a.riskRank || b.riskScore - a.riskScore || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    for (const signal of signals) {
      if (byLevel[signal.riskLevel] !== undefined) byLevel[signal.riskLevel] += 1;
    }
    return {
      metrics: {
        total: signals.length,
        pending: signals.filter((signal) => signal.reviewStatus === "pending").length,
        reviewed: signals.filter((signal) => signal.reviewStatus === "reviewed").length,
        critical: byLevel.critical,
        high: byLevel.high,
        medium: byLevel.medium,
        low: byLevel.low
      },
      byLevel,
      signals: filtered.slice(0, Math.min(Number(query.limit || 250), 1000))
    };
  }

  reviewMembershipRiskSignal(signalId, payload = {}, access) {
    if (!signalId) throw badRequest("signalId is required");
    const branchId = payload.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const reviewStatus = payload.reviewStatus || "reviewed";
    const after = {
      signalId,
      reviewStatus,
      note: text(payload.note || "Reviewed from membership risk center"),
      riskLevel: payload.riskLevel || "",
      membershipId: payload.membershipId || "",
      clientId: payload.clientId || "",
      actor: {
        userId: access.userId || "",
        role: access.role || access.userRole || access.roleName || "",
        branchId,
        timestamp: now()
      }
    };
    this.audit("membership.risk.reviewed", "membership_risk_signal", signalId, {}, after, access, branchId);
    return { id: signalId, reviewStatus, reviewedAt: after.actor.timestamp, actor: after.actor };
  }

  membershipRiskReviewState(access) {
    const rows = db.prepare(
      `SELECT * FROM membership_audit_logs
       WHERE tenant_id = ? AND target_type = 'membership_risk_signal'
       ORDER BY created_at DESC
       LIMIT 1000`
    ).all(access.tenantId).map(rowToAudit);
    const state = new Map();
    for (const row of rows) {
      if (!state.has(row.targetId)) {
        state.set(row.targetId, {
          reviewStatus: row.after?.reviewStatus || "reviewed",
          actorUserId: row.actorUserId,
          createdAt: row.createdAt
        });
      }
    }
    return state;
  }

  riskRank(level = "") {
    return { low: 1, medium: 2, high: 3, critical: 4 }[level] || 0;
  }

  membershipEnterpriseReports(query = {}, access) {
    const branchId = query.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const filters = this.membershipReportFilters(query);
    const memberships = repositories.memberships.list({ limit: 10000 }, scope(access, branchId));
    const clients = repositories.clients.list({ limit: 10000 }, scope(access));
    const clientById = new Map(clients.map((client) => [client.id, client]));
    const ledger = this.ledgerList({ branchId, limit: 1000 }, access);
    const snapshots = db.prepare(
      `SELECT * FROM membership_invoice_snapshots
       WHERE tenant_id = ? AND (? = '' OR branch_id = ?)
       ORDER BY created_at DESC
       LIMIT 1000`
    ).all(access.tenantId, branchId, branchId).map(rowToSnapshot);
    const risks = this.membershipRiskReport({ branchId, riskLevel: filters.riskLevel === "all" ? "" : filters.riskLevel, limit: 1000 }, access).signals || [];
    const riskMembershipIds = new Set(risks.map((risk) => risk.membershipId).filter(Boolean));
    const riskClientIds = new Set(risks.map((risk) => risk.clientId).filter(Boolean));
    const ledgerRows = ledger.filter((row) => this.membershipReportLedgerMatches(row, filters, access, riskMembershipIds, riskClientIds));
    const membershipRows = memberships.filter((membership) => this.membershipReportMembershipMatches(membership, filters, riskMembershipIds, riskClientIds));
    const snapshotRows = snapshots.filter((snapshot) => this.membershipReportSnapshotMatches(snapshot, filters, riskMembershipIds, riskClientIds));
    const todayKey = today();
    const activeMembers = membershipRows
      .filter((membership) => membership.status === "active" && (!membership.validityDate || membership.validityDate >= todayKey))
      .map((membership) => this.membershipReportMembershipRow(membership, clientById));
    const expiringSoon = activeMembers
      .filter((membership) => membership.daysLeft !== null && membership.daysLeft <= 30)
      .sort((a, b) => a.daysLeft - b.daysLeft);
    const renewalLedger = ledgerRows.filter((row) => row.action === "renew");
    const cancelledLedger = ledgerRows.filter((row) => row.action === "cancel");
    const upgradeDowngrade = ledgerRows
      .filter((row) => ["upgrade", "downgrade"].includes(row.action))
      .map((row) => this.membershipReportLedgerRow(row, clientById, access));
    const renewalRevenue = this.membershipRevenueByDate(renewalLedger, clientById, access);
    const cancelledMemberships = [
      ...membershipRows.filter((membership) => membership.status === "cancelled").map((membership) => this.membershipReportMembershipRow(membership, clientById)),
      ...cancelledLedger.map((row) => this.membershipReportLedgerRow(row, clientById, access))
    ].slice(0, 250);
    const commission = this.membershipCommissionReport({ ...query, branchId, limit: 1000 }, access);
    const staffWiseSales = (commission.staff || []).filter((row) => !filters.staffId || row.staffId === filters.staffId);
    const planWiseProfitability = this.membershipPlanProfitability({ memberships: membershipRows, ledger: ledgerRows, snapshots: snapshotRows, access });
    const creditLiability = this.membershipCreditLiability(membershipRows, clientById, access);
    const autoRenewFailedPayments = this.autoRenewQueue({ branchId, limit: 1000 }, access).items
      .filter((item) => item.failedPayment || item.status === "failed_payment" || item.status === "payment_method_missing")
      .filter((item) => !filters.clientId || item.clientId === filters.clientId)
      .filter((item) => !filters.planId || item.planId === filters.planId);
    const discountLeakage = this.membershipDiscountLeakage(snapshotRows, risks);
    const actionQueue = this.membershipActionQueue({
      expiringSoon,
      autoRenewFailedPayments,
      creditLiability,
      planWiseProfitability,
      risks
    });
    const exportRows = this.membershipReportExportRows({
      activeMembers,
      expiringSoon,
      renewalRevenue,
      cancelledMemberships,
      staffWiseSales,
      planWiseProfitability,
      creditLiability,
      autoRenewFailedPayments,
      upgradeDowngrade,
      discountLeakage,
      actionQueue
    });
    return {
      generatedAt: now(),
      filters,
      metrics: {
        activeMembers: activeMembers.length,
        expiringSoon: expiringSoon.length,
        renewalRevenue: money(renewalLedger.reduce((sum, row) => sum + Number(row.paidAmount || row.amount || 0), 0)),
        cancelledMemberships: cancelledMemberships.length,
        staffWiseSales: staffWiseSales.length,
        planWiseProfitability: planWiseProfitability.length,
        creditLiability: money(creditLiability.reduce((sum, row) => sum + Number(row.liabilityValue || 0), 0)),
        autoRenewFailedPayments: autoRenewFailedPayments.length,
        upgradeDowngrade: upgradeDowngrade.length,
        discountLeakage: money(discountLeakage.reduce((sum, row) => sum + Number(row.discountAmount || row.totalDiscount || 0), 0)),
        highRiskSignals: risks.filter((risk) => ["high", "critical"].includes(risk.riskLevel)).length,
        actionQueue: actionQueue.length
      },
      reports: {
        activeMembers,
        expiringSoon,
        renewalRevenue,
        cancelledMemberships,
        staffWiseSales,
        planWiseProfitability,
        creditLiability,
        autoRenewFailedPayments,
        upgradeDowngrade,
        discountLeakage,
        actionQueue
      },
      exportRows: exportRows.slice(0, 2000)
    };
  }

  membershipActionQueue({ expiringSoon = [], autoRenewFailedPayments = [], creditLiability = [], planWiseProfitability = [], risks = [] } = {}) {
    const rows = [];
    const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
    const push = (row) => rows.push({
      id: stableId("membership-action", row.queueType, row.membershipId || row.planId || row.clientId || row.primary, row.priority),
      status: "pending",
      ...row
    });
    for (const row of expiringSoon.slice(0, 50)) {
      push({
        queueType: "expiry_alert",
        priority: Number(row.daysLeft || 0) <= 7 ? "high" : "medium",
        primary: row.clientName,
        clientId: row.clientId,
        membershipId: row.membershipId,
        planId: row.planId,
        planName: row.planName,
        amount: row.price || 0,
        value: row.daysLeft,
        suggestedAction: row.autoRenew ? "Confirm payment method before auto-renew date." : "Send renewal link and WhatsApp follow-up.",
        dueOn: row.expiresOn || ""
      });
    }
    for (const row of autoRenewFailedPayments.slice(0, 50)) {
      push({
        queueType: "auto_renew_recovery",
        priority: row.status === "payment_method_missing" ? "critical" : "high",
        primary: row.clientName || row.clientId,
        clientId: row.clientId,
        membershipId: row.membershipId,
        planId: row.planId,
        planName: row.planName,
        value: row.retryCount || 0,
        suggestedAction: "Update payment method, retry auto-renew, or pause with manager note.",
        dueOn: row.expiresOn || row.nextRetryAt || ""
      });
    }
    for (const row of creditLiability.filter((item) => Number(item.liabilityValue || 0) > 0).slice(0, 40)) {
      push({
        queueType: "credit_liability",
        priority: Number(row.liabilityValue || 0) >= 5000 ? "high" : "medium",
        primary: row.clientName,
        clientId: row.clientId,
        membershipId: row.membershipId,
        planId: row.planId,
        planName: row.planName,
        amount: row.liabilityValue,
        value: row.creditsRemaining,
        suggestedAction: "Check unused credits before renewal, refund, or package upgrade.",
        dueOn: row.expiresOn || ""
      });
    }
    for (const row of planWiseProfitability.filter((item) => Number(item.revenue || 0) > 0 && Number(item.marginPercent || 0) < 20).slice(0, 25)) {
      push({
        queueType: "package_profitability",
        priority: Number(row.marginPercent || 0) < 0 ? "high" : "medium",
        primary: row.planName,
        planId: row.planId,
        planName: row.planName,
        amount: row.grossProfit,
        value: row.marginPercent,
        suggestedAction: "Review price, discount leakage, and credit value for this plan.",
        dueOn: ""
      });
    }
    for (const row of risks.filter((item) => ["critical", "high"].includes(item.riskLevel)).slice(0, 40)) {
      push({
        queueType: "risk_review",
        priority: row.riskLevel,
        primary: row.reason || row.code,
        clientId: row.clientId,
        membershipId: row.membershipId,
        planId: row.planId || "",
        value: row.riskScore || 0,
        suggestedAction: row.suggestedAction || "Review and close the membership risk signal.",
        dueOn: row.createdAt || ""
      });
    }
    return rows
      .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || String(a.dueOn || "").localeCompare(String(b.dueOn || "")))
      .slice(0, 100);
  }

  membershipReportsCsv(query = {}, access) {
    const report = this.membershipEnterpriseReports(query, access);
    const rows = report.exportRows || [];
    const headers = rows.length ? Object.keys(rows[0]) : ["report", "generatedAt", "note"];
    const bodyRows = rows.length ? rows : [{ report: "membership_reports", generatedAt: report.generatedAt, note: "No rows for selected filters" }];
    return [
      headers.join(","),
      ...bodyRows.map((row) => headers.map((header) => this.csvCell(row[header])).join(","))
    ].join("\n");
  }

  membershipReportsPdf(query = {}, access) {
    const report = this.membershipEnterpriseReports(query, access);
    const metrics = report.metrics || {};
    const lines = [
      "AuraShine Membership Enterprise Reports",
      `Generated: ${report.generatedAt}`,
      `Active members: ${metrics.activeMembers || 0}`,
      `Expiring soon: ${metrics.expiringSoon || 0}`,
      `Renewal revenue: Rs ${metrics.renewalRevenue || 0}`,
      `Cancelled memberships: ${metrics.cancelledMemberships || 0}`,
      `Staff-wise sales rows: ${metrics.staffWiseSales || 0}`,
      `Plan profitability rows: ${metrics.planWiseProfitability || 0}`,
      `Credit liability: Rs ${metrics.creditLiability || 0}`,
      `Auto-renew failed/missing payment: ${metrics.autoRenewFailedPayments || 0}`,
      `Upgrade/downgrade rows: ${metrics.upgradeDowngrade || 0}`,
      `Discount leakage: Rs ${metrics.discountLeakage || 0}`,
      `High risk signals: ${metrics.highRiskSignals || 0}`,
      ...report.exportRows.slice(0, 45).map((row) => `${row.report}: ${row.primary || row.clientName || row.planName || row.staffName || ""} ${row.amount || row.value || ""}`)
    ];
    return this.simplePdf(lines);
  }

  membershipReportFilters(query = {}) {
    return {
      fromDate: text(query.fromDate || query.startDate || ""),
      toDate: text(query.toDate || query.endDate || ""),
      branchId: text(query.branchId || ""),
      planId: text(query.planId || ""),
      staffId: text(query.staffId || ""),
      clientId: text(query.clientId || ""),
      status: text(query.status || ""),
      paymentMode: text(query.paymentMode || ""),
      riskLevel: text(query.riskLevel || "all")
    };
  }

  membershipReportLedgerMatches(row, filters, access, riskMembershipIds, riskClientIds) {
    if (filters.fromDate && dateOnly(row.createdAt) < filters.fromDate) return false;
    if (filters.toDate && dateOnly(row.createdAt) > filters.toDate) return false;
    if (filters.branchId && row.branchId !== filters.branchId) return false;
    if (filters.planId && row.planId !== filters.planId) return false;
    if (filters.clientId && row.clientId !== filters.clientId) return false;
    if (filters.paymentMode && row.snapshot?.payment?.mode !== filters.paymentMode) return false;
    if (filters.staffId && this.membershipCommissionActor(row, access).userId !== filters.staffId) return false;
    if (filters.riskLevel && filters.riskLevel !== "all" && !riskMembershipIds.has(row.membershipId) && !riskClientIds.has(row.clientId)) return false;
    return true;
  }

  membershipReportMembershipMatches(membership, filters, riskMembershipIds, riskClientIds) {
    if (filters.branchId && membership.branchId !== filters.branchId) return false;
    if (filters.planId && this.membershipPlanId(membership) !== filters.planId) return false;
    if (filters.clientId && membership.clientId !== filters.clientId) return false;
    if (filters.status && membership.status !== filters.status) return false;
    if (filters.riskLevel && filters.riskLevel !== "all" && !riskMembershipIds.has(membership.id) && !riskClientIds.has(membership.clientId)) return false;
    const startDate = this.membershipStartDate(membership);
    if (filters.fromDate && startDate && startDate < filters.fromDate) return false;
    if (filters.toDate && startDate && startDate > filters.toDate) return false;
    return true;
  }

  membershipReportSnapshotMatches(snapshot, filters, riskMembershipIds, riskClientIds) {
    if (filters.fromDate && dateOnly(snapshot.createdAt) < filters.fromDate) return false;
    if (filters.toDate && dateOnly(snapshot.createdAt) > filters.toDate) return false;
    if (filters.branchId && snapshot.branchId !== filters.branchId) return false;
    if (filters.planId && snapshot.planId !== filters.planId) return false;
    if (filters.clientId && snapshot.clientId !== filters.clientId) return false;
    if (filters.staffId) {
      const staffId = snapshot.terms?.membershipRedeem?.staffId || snapshot.terms?.membershipBenefit?.staffId || "";
      if (staffId !== filters.staffId) return false;
    }
    if (filters.riskLevel && filters.riskLevel !== "all" && !riskMembershipIds.has(snapshot.membershipId) && !riskClientIds.has(snapshot.clientId)) return false;
    return true;
  }

  membershipReportMembershipRow(membership, clientById) {
    const client = clientById.get(membership.clientId) || {};
    return {
      membershipId: membership.id,
      clientId: membership.clientId,
      clientName: client.name || client.fullName || membership.clientId,
      phone: client.phone || "",
      planId: this.membershipPlanId(membership),
      planName: membership.planName || "Membership",
      branchId: membership.branchId || "",
      status: membership.status || "active",
      takenOn: this.membershipStartDate(membership),
      expiresOn: membership.validityDate || "",
      daysLeft: membership.validityDate ? this.daysLeft(membership.validityDate) : null,
      price: money(membership.price || 0),
      creditsRemaining: Number(membership.creditsRemaining || 0),
      planCredits: Number(membership.planCredits || 0),
      autoRenew: Boolean(Number(membership.autoRenew || 0))
    };
  }

  membershipReportLedgerRow(row, clientById, access) {
    const client = clientById.get(row.clientId) || {};
    const actor = this.membershipCommissionActor(row, access);
    return {
      id: row.id,
      membershipId: row.membershipId,
      clientId: row.clientId,
      clientName: client.name || client.fullName || row.clientId,
      planId: row.planId,
      branchId: row.branchId,
      action: row.action,
      paymentMode: row.snapshot?.payment?.mode || "",
      referenceNo: row.snapshot?.payment?.referenceNo || "",
      amount: money(row.paidAmount || row.amount || 0),
      refundAmount: this.membershipCommissionRefundValue(row),
      staffId: actor.userId,
      staffName: actor.name || actor.label || "System",
      createdAt: row.createdAt,
      note: row.note
    };
  }

  membershipRevenueByDate(rows, clientById, access) {
    const byDate = new Map();
    for (const row of rows) {
      const key = dateOnly(row.createdAt);
      const actor = this.membershipCommissionActor(row, access);
      const current = byDate.get(key) || { date: key, revenue: 0, count: 0, staff: new Set(), clients: new Set() };
      current.revenue = money(current.revenue + Number(row.paidAmount || row.amount || 0));
      current.count += 1;
      if (actor.name) current.staff.add(actor.name);
      if (row.clientId) current.clients.add(clientById.get(row.clientId)?.name || row.clientId);
      byDate.set(key, current);
    }
    return [...byDate.values()].map((row) => ({
      date: row.date,
      revenue: row.revenue,
      count: row.count,
      staffCount: row.staff.size,
      clientCount: row.clients.size
    })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  membershipPlanProfitability({ memberships = [], ledger = [], snapshots = [], access }) {
    const byPlan = new Map();
    const ensure = (planId, planName = "Membership") => {
      const key = planId || planName || "unknown";
      if (!byPlan.has(key)) {
        byPlan.set(key, { planId, planName, revenue: 0, discountLeakage: 0, creditLiability: 0, activeMembers: 0, saleCount: 0, renewalCount: 0, upgradeCount: 0 });
      }
      return byPlan.get(key);
    };
    for (const row of ledger.filter((item) => ["sold", "renew", "upgrade"].includes(item.action))) {
      const planName = row.snapshot?.plan?.name || row.snapshot?.membership?.planName || row.snapshot?.after?.planName || row.planId || "Membership";
      const bucket = ensure(row.planId, planName);
      bucket.revenue = money(bucket.revenue + Number(row.paidAmount || row.amount || 0));
      if (row.action === "sold") bucket.saleCount += 1;
      if (row.action === "renew") bucket.renewalCount += 1;
      if (row.action === "upgrade") bucket.upgradeCount += 1;
    }
    for (const membership of memberships.filter((item) => item.status === "active")) {
      const bucket = ensure(this.membershipPlanId(membership), membership.planName);
      bucket.activeMembers += 1;
      bucket.creditLiability = money(bucket.creditLiability + this.membershipCreditLiabilityValue(membership, access));
    }
    for (const snapshot of snapshots) {
      const bucket = ensure(snapshot.planId, snapshot.planName);
      bucket.discountLeakage = money(bucket.discountLeakage + Number(snapshot.discountAmount || 0));
    }
    return [...byPlan.values()].map((row) => ({
      ...row,
      grossProfit: money(row.revenue - row.discountLeakage - row.creditLiability),
      marginPercent: row.revenue ? Math.round(((row.revenue - row.discountLeakage - row.creditLiability) / row.revenue) * 1000) / 10 : 0
    })).sort((a, b) => b.revenue - a.revenue);
  }

  membershipCreditLiability(memberships, clientById, access) {
    return memberships
      .filter((membership) => membership.status === "active" && Number(membership.creditsRemaining || 0) > 0)
      .map((membership) => ({
        ...this.membershipReportMembershipRow(membership, clientById),
        liabilityValue: this.membershipCreditLiabilityValue(membership, access),
        valuePerCredit: this.membershipCreditValue(membership, access)
      }))
      .sort((a, b) => b.liabilityValue - a.liabilityValue);
  }

  membershipCreditLiabilityValue(membership, access) {
    return money(Number(membership.creditsRemaining || 0) * this.membershipCreditValue(membership, access));
  }

  membershipCreditValue(membership, access) {
    const credits = Number(membership.planCredits || 0);
    if (credits > 0 && Number(membership.price || 0) > 0) return money(Number(membership.price || 0) / credits);
    const plan = this.safeResolveMembershipPlan(membership, access);
    if (plan?.price && plan?.benefitRules?.creditValue) return money(plan.benefitRules.creditValue);
    return 500;
  }

  safeResolveMembershipPlan(membership, access) {
    try {
      return this.resolveMembershipPlan(membership, access);
    } catch {
      return null;
    }
  }

  membershipDiscountLeakage(snapshots, risks) {
    const riskBySnapshotMembership = new Map(risks.filter((risk) => risk.code === "high_discount_misuse").map((risk) => [risk.membershipId || risk.clientId, risk]));
    return snapshots
      .filter((snapshot) => Number(snapshot.discountAmount || 0) > 0)
      .map((snapshot) => ({
        id: snapshot.id,
        invoiceId: snapshot.invoiceId,
        membershipId: snapshot.membershipId,
        clientId: snapshot.clientId,
        planId: snapshot.planId,
        planName: snapshot.planName,
        discountPercent: snapshot.discountPercent,
        discountAmount: snapshot.discountAmount,
        invoiceTotal: snapshot.invoiceTotal,
        riskLevel: riskBySnapshotMembership.get(snapshot.membershipId)?.riskLevel || riskBySnapshotMembership.get(snapshot.clientId)?.riskLevel || (snapshot.discountAmount > 1500 || snapshot.discountPercent > 50 ? "high" : "low"),
        createdAt: snapshot.createdAt
      }))
      .sort((a, b) => b.discountAmount - a.discountAmount);
  }

  membershipReportExportRows(reportSets = {}) {
    const rows = [];
    const push = (report, row, primary, amount = "") => rows.push({
      report,
      primary,
      membershipId: row.membershipId || row.id || "",
      clientId: row.clientId || "",
      clientName: row.clientName || "",
      planId: row.planId || "",
      planName: row.planName || "",
      staffId: row.staffId || "",
      staffName: row.staffName || "",
      status: row.status || row.action || row.riskLevel || "",
      amount,
      value: row.revenue ?? row.liabilityValue ?? row.discountAmount ?? row.amount ?? "",
      date: row.date || row.createdAt || row.takenOn || row.expiresOn || "",
      note: row.note || row.suggestedAction || ""
    });
    for (const row of reportSets.activeMembers || []) push("active_members", row, row.clientName, row.price);
    for (const row of reportSets.expiringSoon || []) push("expiring_soon", row, row.clientName, row.daysLeft);
    for (const row of reportSets.renewalRevenue || []) push("renewal_revenue", row, row.date, row.revenue);
    for (const row of reportSets.cancelledMemberships || []) push("cancelled_memberships", row, row.clientName || row.membershipId, row.amount || row.price || "");
    for (const row of reportSets.staffWiseSales || []) push("staff_wise_sales", row, row.staffName, row.commissionPreview);
    for (const row of reportSets.planWiseProfitability || []) push("plan_wise_profitability", row, row.planName, row.grossProfit);
    for (const row of reportSets.creditLiability || []) push("credit_liability", row, row.clientName, row.liabilityValue);
    for (const row of reportSets.autoRenewFailedPayments || []) push("auto_renew_failed_payments", row, row.clientName, row.price);
    for (const row of reportSets.upgradeDowngrade || []) push("upgrade_downgrade", row, row.clientName, row.amount || row.refundAmount);
    for (const row of reportSets.discountLeakage || []) push("discount_leakage", row, row.invoiceId, row.discountAmount);
    for (const row of reportSets.actionQueue || []) push("membership_action_queue", row, row.primary, row.amount || row.value);
    return rows;
  }

  csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  simplePdf(lines = []) {
    const safeLines = lines.slice(0, 90).map((line) => this.pdfText(line).slice(0, 115));
    const stream = [
      "BT",
      "/F1 11 Tf",
      "50 780 Td",
      "14 TL",
      ...safeLines.flatMap((line) => [`(${line}) Tj`, "T*"]),
      "ET"
    ].join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>\n",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\n",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\n`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n"
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}endobj\n`;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
  }

  pdfText(value) {
    return String(value ?? "").replace(/[()\\]/g, " ").replace(/[^\x20-\x7E]/g, " ");
  }

  plan360(id, access) {
    const plan = this.getPlan(id, access);
    const memberships = repositories.memberships.list({ limit: 10000 }, scope(access, plan.branchId || ""))
      .filter((membership) => this.membershipPlanId(membership) === id || membership.planName === plan.name);
    const ledger = this.ledgerList({ branchId: plan.branchId || "", limit: 1000 }, access).filter((item) => item.planId === id || memberships.some((membership) => membership.id === item.membershipId));
    const snapshots = db.prepare("SELECT * FROM membership_invoice_snapshots WHERE tenant_id = ? AND plan_id = ? ORDER BY created_at DESC LIMIT 100").all(access.tenantId, id);
    const soldRevenue = ledger.filter((item) => ["sold", "renew", "upgrade"].includes(item.action)).reduce((sum, item) => sum + Number(item.paidAmount || item.amount || 0), 0);
    const redeemedDiscount = snapshots.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);
    const wallets = [];
    for (const clientId of [...new Set(memberships.map((item) => item.clientId).filter(Boolean))]) {
      try {
        wallets.push(this.membershipWallet(clientId, { branchId: plan.branchId || "" }, access));
      } catch {
        // Wallet snapshots should not hide the plan 360 page if one client record is stale.
      }
    }
    return {
      plan,
      metrics: {
        soldClients: new Set(memberships.map((item) => item.clientId)).size,
        active: memberships.filter((item) => item.status === "active" && (!item.validityDate || item.validityDate >= today())).length,
        expired: memberships.filter((item) => item.validityDate && item.validityDate < today()).length,
        revenue: money(soldRevenue),
        redeemedDiscount: money(redeemedDiscount),
        renewalRisk: memberships.filter((item) => item.validityDate && this.daysLeft(item.validityDate) <= 30).length
      },
      memberships,
      wallets,
      ledger: ledger.slice(0, 100),
      snapshots: snapshots.map((row) => ({
        id: row.id,
        invoiceId: row.invoice_id,
        clientId: row.client_id,
        discountAmount: Number(row.discount_amount || 0),
        invoiceTotal: Number(row.invoice_total || 0),
        createdAt: row.created_at
      }))
    };
  }

  membership360(id, access) {
    const membership = repositories.memberships.getById(id, scope(access));
    if (!membership) throw notFound("Membership not found");
    const branchId = membership.branchId || access.requestedBranchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const client = membership.clientId ? repositories.clients.getById(membership.clientId, scope(access)) : null;
    const plan = this.resolveMembershipPlan(membership, access);
    const ledger = this.membershipLedgerRows(id, access);
    const auditTrail = this.membershipAuditRows(id, access);
    const reminders = this.membershipReminderRows(id, access);
    const snapshots = this.membershipSnapshotRows(membership, plan, access);
    const wallet = client ? this.safeMembershipWallet(client.id, { branchId }, access) : null;
    const invoiceLinks = this.membershipInvoiceLinks(ledger, snapshots);
    const paymentHistory = this.membershipPaymentHistory(ledger);
    const timeline = this.membershipTimeline({ membership, ledger, auditTrail, snapshots, reminders, access });
    const riskSignals = this.membershipRiskSignals({ membership, ledger, auditTrail, reminders, snapshots, wallet, access });
    return {
      type: "membership",
      membershipProfile: {
        id: membership.id,
        status: membership.status || "active",
        branchId,
        takenDate: this.membershipStartDate(membership),
        expiryDate: membership.validityDate || "",
        daysLeft: membership.validityDate ? this.daysLeft(membership.validityDate) : null,
        autoRenew: Boolean(Number(membership.autoRenew || 0)),
        creditsRemaining: Number(membership.creditsRemaining || 0),
        planCredits: Number(membership.planCredits || 0),
        price: money(membership.price || plan.price || 0),
        discountPercent: this.discountPercent(membership) || plan.discountPercent || 0,
        productDiscountPercent: this.productDiscountPercent(membership) || plan.productDiscountPercent || 0
      },
      client: client ? {
        id: client.id,
        name: client.name || client.fullName || "",
        phone: client.phone || "",
        email: client.email || "",
        branchId: client.branchId || ""
      } : { id: membership.clientId, name: membership.clientId, phone: "", email: "", branchId: "" },
      currentPlan: {
        ...compactPlan(plan),
        code: plan.code || "",
        status: plan.status || "active",
        benefitRules: plan.benefitRules || {},
        includedServices: plan.includedServices || []
      },
      membership,
      wallet,
      paymentHistory,
      lifecycleTimeline: timeline,
      invoiceLinks,
      staffAttribution: this.membershipStaffAttribution(ledger, auditTrail, snapshots, access),
      auditTrail,
      riskSignals,
      whatsappReminders: reminders,
      snapshots,
      metrics: {
        payments: paymentHistory.length,
        timelineEvents: timeline.length,
        invoices: invoiceLinks.length,
        auditEvents: auditTrail.length,
        riskSignals: riskSignals.length,
        reminders: reminders.length,
        redeemedEvents: ledger.filter((row) => ["redeemed", "discount_applied"].includes(row.action)).length
      }
    };
  }

  selfServiceStatusLinkPreview(clientId, query = {}, access) {
    const token = stableId("mss_preview", access.tenantId, clientId, query.branchId || "");
    return {
      link: this.selfServiceStatusUrl(token, query),
      tokenPreview: token,
      expiresAt: addDays(today(), Number(query.validityDays || 30)),
      status: "preview",
      createRoute: `/api/membership-enterprise/client/${clientId}/self-service/status-link`
    };
  }

  selfServiceStatusUrl(token, payload = {}) {
    const baseUrl = text(payload.baseUrl || payload.origin || "");
    const path = `/memberships/self-service/${token}`;
    return baseUrl ? `${baseUrl.replace(/\/+$/, "")}${path}` : path;
  }

  clientExpiryReminders(clientId, branchId, access) {
    return db.prepare(
      `SELECT * FROM membership_whatsapp_reminders
       WHERE tenant_id = ?
         AND client_id = ?
         AND (? = '' OR branch_id = ?)
       ORDER BY due_on ASC, created_at DESC
       LIMIT 50`
    ).all(access.tenantId, clientId, branchId || "", branchId || "").map(rowToReminder);
  }

  whatsappMembershipSummaryText(client = {}, wallet = {}, reminders = []) {
    const plan = wallet.activePlanName || wallet.activeMembership?.planName || "No active membership";
    const credits = Number(wallet.remainingCredits || wallet.serviceCredits?.remaining || 0);
    const expiry = wallet.expiryDate || "not set";
    const daysLeft = wallet.daysLeft === null || wallet.daysLeft === undefined ? "-" : `${wallet.daysLeft} days`;
    const discount = Number(wallet.bestDiscountPercent || wallet.planBenefits?.serviceDiscountPercent || 0);
    const reminder = reminders[0]?.dueOn ? `Next reminder: ${reminders[0].dueOn}.` : "Renewal reminder is not queued yet.";
    return [
      `Hi ${client.name || client.fullName || "Client"},`,
      `Membership: ${plan}`,
      `Service discount: ${discount}%`,
      `Remaining credits: ${credits}`,
      `Expiry: ${expiry} (${daysLeft} left)`,
      reminder,
      "Renewal/payment links are approval-safe and will be shared by AuraShine team."
    ].join("\n");
  }

  createMembershipSelfServiceRequest({
    branchId = "",
    clientId = "",
    membershipId = "",
    requestType = "",
    status = "pending",
    reason = "",
    token = "",
    tokenExpiresAt = "",
    requestPayload = {},
    responsePayload = {},
    approvalRequired = true,
    requestedBy = "client"
  } = {}, access) {
    if (!clientId) throw badRequest("clientId is required");
    if (!requestType) throw badRequest("requestType is required");
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const stamp = now();
    const row = {
      id: makeId("mssr"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      client_id: clientId,
      membership_id: membershipId,
      request_type: requestType,
      status,
      reason,
      token,
      token_expires_at: tokenExpiresAt,
      request_payload_json: stringify(requestPayload),
      response_payload_json: stringify(responsePayload),
      approval_required: approvalRequired ? 1 : 0,
      requested_by: requestedBy,
      requested_at: stamp,
      reviewed_by: "",
      reviewed_role: "",
      reviewed_at: "",
      rejection_reason: "",
      version: 1,
      created_at: stamp,
      updated_at: stamp
    };
    db.prepare(
      `INSERT INTO membership_self_service_requests
       (id, tenant_id, branch_id, client_id, membership_id, request_type, status, reason, token, token_expires_at,
        request_payload_json, response_payload_json, approval_required, requested_by, requested_at,
        reviewed_by, reviewed_role, reviewed_at, rejection_reason, version, created_at, updated_at)
       VALUES
       (@id, @tenant_id, @branch_id, @client_id, @membership_id, @request_type, @status, @reason, @token, @token_expires_at,
        @request_payload_json, @response_payload_json, @approval_required, @requested_by, @requested_at,
        @reviewed_by, @reviewed_role, @reviewed_at, @rejection_reason, @version, @created_at, @updated_at)`
    ).run(row);
    const mapped = rowToSelfServiceRequest(row);
    this.audit("membership.self_service.requested", "membership_self_service_request", row.id, {}, mapped, access, branchId);
    realtimeService.broadcast("membership:self_service_requested", { id: row.id, requestType, membershipId, clientId }, { tenantId: access.tenantId, branchId });
    return mapped;
  }

  getMembershipForSelfService(membershipId, access) {
    if (!membershipId) throw badRequest("membershipId is required");
    const membership = repositories.memberships.getById(membershipId, scope(access));
    if (!membership) throw notFound("Membership not found");
    if (membership.branchId) tenantService.assertBranchAccess(access, membership.branchId);
    return membership;
  }

  getSelfServiceRequestRow(id, access) {
    const row = db.prepare("SELECT * FROM membership_self_service_requests WHERE tenant_id = ? AND id = ?").get(access.tenantId, id);
    if (!row) throw notFound("Self-service request not found");
    return row;
  }

  membershipRole(access = {}) {
    return String(access.role || access.userRole || access.roleName || "").toLowerCase().replace(/[\s_-]+/g, "");
  }

  membershipActor(access = {}, branchId = "") {
    return {
      userId: access.userId || "",
      role: access.role || access.userRole || access.roleName || "",
      branchId: branchId || access.requestedBranchId || access.branchId || "",
      timestamp: now()
    };
  }

  assertMembershipLifecycleActor(access = {}) {
    if (MEMBERSHIP_LIFECYCLE_ROLES.has(this.membershipRole(access))) return;
    throw forbidden("Only owner, super admin, manager or cashier can request membership lifecycle changes");
  }

  assertMembershipManager(access = {}) {
    if (MEMBERSHIP_APPROVAL_ROLES.has(this.membershipRole(access))) return;
    throw forbidden("Owner or manager approval is required for membership self-service cancellation/refund");
  }

  selfServiceContextForToken(token) {
    if (!token) throw badRequest("Self-service token is required");
    const row = db.prepare(
      `SELECT * FROM membership_self_service_requests
       WHERE token = ?
         AND request_type = 'status_link'
         AND status IN ('ready', 'approved')
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(token);
    if (!row) throw notFound("Self-service link not found");
    if (row.token_expires_at && row.token_expires_at < today()) throw badRequest("Self-service link has expired");
    const request = rowToSelfServiceRequest(row);
    const access = {
      tenantId: row.tenant_id,
      branchId: row.branch_id || "",
      requestedBranchId: row.branch_id || "",
      branchIds: row.branch_id ? [row.branch_id] : [],
      role: "owner",
      userId: `self_service:${row.client_id}`
    };
    return {
      request,
      access,
      branchId: row.branch_id || "",
      clientId: row.client_id,
      membershipId: row.membership_id || ""
    };
  }

  posSuggestion(clientId, query = {}, access) {
    const client = repositories.clients.getById(clientId, scope(access));
    if (!client) throw notFound("Client not found");
    const eligibility = this.eligibility(clientId, query, access);
    const plans = this.listPlans({ branchId: query.branchId || client.branchId || "", status: "active" }, access);
    const bestPlan = plans.sort((a, b) => b.discountPercent - a.discountPercent || a.price - b.price)[0] || null;
    const reasons = [];
    if (eligibility.activeMembership) reasons.push("Client already has an active membership.");
    if (!eligibility.activeMembership && Number(client.visitCount || 0) >= 2) reasons.push("Repeat client without membership.");
    if (!eligibility.activeMembership && Number(client.totalSpend || 0) >= 1500) reasons.push("High spend client can benefit from recurring discount.");
    if (eligibility.renewDue) reasons.push("Membership renewal window is open.");
    return {
      clientId,
      recommendedPlan: eligibility.activeMembership ? null : bestPlan,
      eligibility,
      shouldOffer: !eligibility.activeMembership && Boolean(bestPlan) && (Number(client.visitCount || 0) >= 2 || Number(client.totalSpend || 0) >= 1000),
      confidence: eligibility.activeMembership ? 0.2 : Math.min(0.95, 0.45 + Number(client.visitCount || 0) * 0.1 + Number(client.totalSpend || 0) / 10000),
      reasons
    };
  }

  membershipLedgerRows(membershipId, access) {
    return db.prepare(
      `SELECT * FROM client_membership_ledger
       WHERE tenant_id = ? AND membership_id = ?
       ORDER BY created_at DESC
       LIMIT 500`
    ).all(access.tenantId, membershipId).map(rowToLedger);
  }

  membershipAuditRows(membershipId, access) {
    return db.prepare(
      `SELECT * FROM membership_audit_logs
       WHERE tenant_id = ? AND target_type = 'membership' AND target_id = ?
       ORDER BY created_at DESC
       LIMIT 500`
    ).all(access.tenantId, membershipId).map((row) => {
      const audit = rowToAudit(row);
      return {
        ...audit,
        actor: this.resolveActor(audit.actorUserId, access),
        riskFlags: this.extractRiskFlags(audit.after)
      };
    });
  }

  membershipReminderRows(membershipId, access) {
    return db.prepare(
      `SELECT * FROM membership_whatsapp_reminders
       WHERE tenant_id = ? AND membership_id = ?
       ORDER BY due_on ASC, created_at DESC
       LIMIT 200`
    ).all(access.tenantId, membershipId).map(rowToReminder);
  }

  membershipSnapshotRows(membership = {}, plan = {}, access) {
    const rows = db.prepare(
      `SELECT * FROM membership_invoice_snapshots
       WHERE tenant_id = ?
         AND (
           membership_id = ?
           OR (membership_id = '' AND client_id = ? AND (? = '' OR plan_id = ? OR plan_name = ?))
         )
       ORDER BY created_at DESC
       LIMIT 200`
    ).all(access.tenantId, membership.id || "", membership.clientId || "", plan.id || "", plan.id || "", membership.planName || plan.name || "");
    return rows.map(rowToSnapshot);
  }

  safeMembershipWallet(clientId, query, access) {
    try {
      return this.membershipWallet(clientId, query, access);
    } catch {
      return null;
    }
  }

  membershipPaymentHistory(ledger = []) {
    return ledger
      .filter((row) => ["sold", "renew", "upgrade", "downgrade", "cancel"].includes(row.action) || Number(row.paidAmount || row.amount || 0) !== 0)
      .map((row) => {
        const payment = row.snapshot?.payment || {};
        const actor = row.snapshot?.actor || {};
        return {
          id: row.id,
          action: row.action,
          amount: row.amount,
          paidAmount: row.paidAmount,
          refundAmount: Number(payment.refundAmount || 0),
          creditNoteAmount: Number(payment.creditNoteAmount || 0),
          paymentMode: payment.mode || payment.paymentMode || "",
          referenceNo: payment.referenceNo || "",
          invoiceId: row.invoiceId || "",
          createdAt: row.createdAt,
          note: row.note || "",
          actorUserId: actor.userId || row.actorUserId || "",
          actorRole: actor.role || ""
        };
      });
  }

  membershipInvoiceLinks(ledger = [], snapshots = []) {
    const links = new Map();
    for (const row of [...ledger, ...snapshots]) {
      const invoiceId = row.invoiceId;
      if (!invoiceId || links.has(invoiceId)) continue;
      links.set(invoiceId, {
        invoiceId,
        label: row.invoiceId,
        saleId: row.saleId || "",
        amount: Number(row.invoiceTotal || row.amount || row.paidAmount || 0),
        discountAmount: Number(row.discountAmount || 0),
        createdAt: row.createdAt || "",
        route: `/billing/invoices/${invoiceId}`
      });
    }
    return [...links.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  membershipTimeline({ membership, ledger = [], auditTrail = [], snapshots = [], reminders = [], access }) {
    const events = [];
    for (const row of ledger) {
      const actorUserId = row.snapshot?.actor?.userId || row.actorUserId || "";
      const actor = this.resolveActor(actorUserId, access);
      events.push({
        id: row.id,
        source: "ledger",
        action: row.action,
        label: this.membershipActionLabel(row.action),
        createdAt: row.createdAt,
        amount: row.amount,
        paidAmount: row.paidAmount,
        invoiceId: row.invoiceId,
        invoiceRoute: row.invoiceId ? `/billing/invoices/${row.invoiceId}` : "",
        note: row.note,
        actor,
        staffAttribution: actor,
        evidence: row.snapshot || {}
      });
    }
    for (const audit of auditTrail) {
      const actor = audit.actor || this.resolveActor(audit.actorUserId, access);
      events.push({
        id: audit.id,
        source: "audit",
        action: audit.action,
        label: this.membershipActionLabel(audit.action),
        createdAt: audit.createdAt,
        note: audit.reason || audit.after?.note || "",
        actor,
        staffAttribution: actor,
        riskFlags: audit.riskFlags || [],
        evidence: { before: audit.before, after: audit.after }
      });
    }
    for (const snapshot of snapshots) {
      const actor = this.resolveActor("", access);
      events.push({
        id: snapshot.id,
        source: "invoice_snapshot",
        action: snapshot.creditsUsed > 0 ? "redeemed" : "discount_applied",
        label: snapshot.creditsUsed > 0 ? "Redeemed" : "Discount applied",
        createdAt: snapshot.createdAt,
        amount: snapshot.invoiceTotal,
        discountAmount: snapshot.discountAmount,
        invoiceId: snapshot.invoiceId,
        invoiceRoute: snapshot.invoiceId ? `/billing/invoices/${snapshot.invoiceId}` : "",
        note: `${snapshot.discountPercent}% benefit applied`,
        actor,
        staffAttribution: actor,
        evidence: snapshot
      });
    }
    for (const reminder of reminders) {
      const actor = this.resolveActor(reminder.approvedBy, access);
      events.push({
        id: reminder.id,
        source: "whatsapp_reminder",
        action: `whatsapp_${reminder.status || "queued"}`,
        label: `WhatsApp ${reminder.status || "queued"}`,
        createdAt: reminder.createdAt || reminder.dueOn,
        note: reminder.message,
        actor,
        staffAttribution: actor,
        evidence: reminder
      });
    }
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    for (const item of history.slice(0, 50)) {
      const actor = this.resolveActor(item.actorUserId || "", access);
      events.push({
        id: `${membership.id}-${item.date || ""}-${item.type || "history"}`,
        source: "membership_record",
        action: item.type || "membership_event",
        label: this.membershipActionLabel(item.type || "membership_event"),
        createdAt: item.date || membership.createdAt || "",
        amount: Number(item.amount || item.paidAmount || item.refundAmount || 0),
        invoiceId: item.invoiceId || "",
        invoiceRoute: item.invoiceId ? `/billing/invoices/${item.invoiceId}` : "",
        note: item.note || "",
        actor,
        staffAttribution: actor,
        evidence: item
      });
    }
    const unique = new Map();
    for (const event of events) {
      const key = `${event.source}:${event.id}:${event.action}:${event.createdAt}`;
      if (!unique.has(key)) unique.set(key, event);
    }
    return [...unique.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 300);
  }

  membershipRiskSignals({ membership, ledger = [], auditTrail = [], reminders = [], snapshots = [], wallet = null }) {
    const signals = [];
    const daysLeft = membership.validityDate ? this.daysLeft(membership.validityDate) : null;
    const addSignal = (code, level, reason, suggestedAction, evidence = {}) => {
      signals.push({ code, riskLevel: level, reason, suggestedAction, evidence });
    };
    if (daysLeft !== null && daysLeft < 0 && membership.status !== "cancelled") {
      addSignal("expired_active_membership", "high", "Membership expiry date has passed but status is not cancelled.", "Review renewal or mark expired.", { daysLeft });
    }
    if (daysLeft !== null && daysLeft <= 7 && membership.status === "active") {
      addSignal("renewal_window", daysLeft < 0 ? "high" : "medium", "Membership is inside renewal window.", "Queue WhatsApp reminder and confirm renewal payment.", { daysLeft });
    }
    const zeroValue = ledger.find((row) => ["renew", "upgrade"].includes(row.action) && Number(row.paidAmount || row.amount || 0) <= 0);
    if (zeroValue) {
      addSignal("zero_value_lifecycle", "high", "Renew/upgrade ledger has zero paid amount.", "Verify approval reason and payment audit.", zeroValue);
    }
    const failedRetry = auditTrail.find((row) => row.action === "membership.auto_renew.retry_failed");
    if (failedRetry) {
      addSignal("auto_renew_failed", "high", failedRetry.after?.failureReason || "Auto-renew retry failed.", "Update payment method before retrying.", failedRetry);
    }
    if (Number(membership.autoRenew || 0) && reminders.some((row) => row.reminderType?.includes("payment_method"))) {
      addSignal("payment_method_missing", "medium", "Auto-renew is on but saved payment method is missing.", "Collect UPI mandate/card token before charging.", reminders);
    }
    const refund = ledger.find((row) => row.action === "downgrade" && Number(row.amount || 0) > 0);
    if (refund) {
      addSignal("downgrade_credit_note", "medium", "Downgrade generated credit/refund value.", "Check credit note/refund approval.", refund);
    }
    if (snapshots.filter((row) => Number(row.discountAmount || 0) > 0).length >= 5) {
      addSignal("high_discount_usage", "medium", "Multiple invoice discounts were applied through this membership.", "Review benefit usage against plan rules.", snapshots.slice(0, 5));
    }
    if (wallet && Number(wallet.remainingCredits || wallet.serviceCredits?.remaining || 0) <= 0 && membership.status === "active") {
      addSignal("credits_exhausted", "low", "Membership is active but service credits are exhausted.", "Offer upgrade or renewal package.", wallet);
    }
    return signals;
  }

  membershipStaffAttribution(ledger = [], auditTrail = [], snapshots = [], access) {
    const actors = new Map();
    const add = (actorUserId, source, createdAt, action) => {
      const actor = this.resolveActor(actorUserId, access);
      const key = actor.userId || actor.label || "system";
      const current = actors.get(key) || { ...actor, actions: 0, sources: [], lastActionAt: "", lastAction: "" };
      current.actions += 1;
      current.sources = [...new Set([...current.sources, source])];
      if (!current.lastActionAt || String(createdAt || "").localeCompare(current.lastActionAt) > 0) {
        current.lastActionAt = createdAt || "";
        current.lastAction = action || "";
      }
      actors.set(key, current);
    };
    for (const row of ledger) add(row.snapshot?.actor?.userId || row.actorUserId || "", "ledger", row.createdAt, row.action);
    for (const row of auditTrail) add(row.actorUserId || row.after?.actor?.userId || "", "audit", row.createdAt, row.action);
    for (const row of snapshots) add(row.terms?.membershipRedeem?.staffId || row.terms?.membershipBenefit?.staffId || "", "invoice_snapshot", row.createdAt, row.invoiceId);
    return [...actors.values()].sort((a, b) => b.actions - a.actions);
  }

  resolveActor(actorUserId, access) {
    if (!actorUserId) {
      return { userId: "", name: "System", role: "system", label: "System" };
    }
    const candidates = [
      () => repositories.staff.getById(actorUserId, scope(access)),
      () => repositories.tenantUsers.getById(actorUserId, scope(access)),
      () => db.prepare("SELECT id, name, full_name AS fullName, role, branch_id AS branchId FROM staff_master WHERE tenant_id = ? AND id = ?").get(access.tenantId, actorUserId)
    ];
    for (const readActor of candidates) {
      try {
        const row = readActor();
        if (!row) continue;
        const name = row.name || row.fullName || row.full_name || [row.firstName, row.lastName].filter(Boolean).join(" ");
        return {
          userId: actorUserId,
          name: name || actorUserId,
          role: row.role || row.roleName || row.designation || "",
          branchId: row.branchId || row.branch_id || "",
          label: `${name || actorUserId}${row.role ? ` · ${row.role}` : ""}`
        };
      } catch {
        // Some deployments may not have every optional staff/user table yet.
      }
    }
    return { userId: actorUserId, name: actorUserId, role: "", label: actorUserId };
  }

  extractRiskFlags(value = {}) {
    if (Array.isArray(value.riskFlags)) return value.riskFlags;
    if (Array.isArray(value.risk_flags)) return value.risk_flags;
    if (value.failureReason) return [{ code: value.failureReason, level: "high", reason: value.failureReason }];
    return [];
  }

  membershipActionLabel(action = "") {
    const value = String(action || "").replace(/^membership[._-]/, "").replace(/^auto_renew[._-]/, "auto renew ").replace(/_/g, " ");
    return value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Membership event";
  }

  prorationPreview(membershipId, payload = {}, access) {
    const membership = repositories.memberships.getById(membershipId, scope(access));
    if (!membership) throw notFound("Membership not found");
    if (membership.branchId) tenantService.assertBranchAccess(access, membership.branchId);
    return this.buildProrationPreview(membership, payload, access);
  }

  buildProrationPreview(membership = {}, payload = {}, access = {}) {
    const action = text(payload.action || "upgrade").toLowerCase();
    if (!["upgrade", "downgrade", "renew"].includes(action)) {
      throw badRequest("action must be upgrade, downgrade or renew");
    }
    const currentPlan = this.resolveMembershipPlan(membership, access);
    const targetPlanId = text(payload.targetPlanId || payload.planId);
    let targetPlan = currentPlan;
    if (targetPlanId) {
      targetPlan = this.getPlan(targetPlanId, access);
    } else if (action !== "renew") {
      throw badRequest("targetPlanId is required for upgrade/downgrade preview");
    }
    const effectiveDate = dateOnly(payload.effectiveDate || today());
    const currentExpiry = membership.validityDate ? dateOnly(membership.validityDate) : "";
    const startDate = this.membershipStartDate(membership);
    const fallbackValidityDays = Math.max(Number(currentPlan.validityDays || targetPlan.validityDays || payload.validityDays || 365), 1);
    const currentPlanDays = currentExpiry ? daysBetween(startDate, currentExpiry) : fallbackValidityDays;
    const usedDays = currentExpiry ? daysBetween(startDate, effectiveDate) : 0;
    const remainingDays = currentExpiry ? daysBetween(effectiveDate, currentExpiry) : 0;
    const totalDays = Math.max(currentPlanDays, usedDays + remainingDays, fallbackValidityDays, 1);
    const validityDays = Math.max(Number(payload.validityDays || targetPlan.validityDays || currentPlan.validityDays || 365), 1);
    const addCredits = Math.max(Number(payload.addCredits || 0), 0);
    const unusedValue = currentExpiry ? money(Number(currentPlan.price || 0) * (remainingDays / totalDays)) : 0;
    const targetValue = money(Number(targetPlan.price || 0));
    const delta = money(targetValue - unusedValue);
    const baseForRenewal = currentExpiry && currentExpiry > effectiveDate ? currentExpiry : effectiveDate;
    const newExpiryDate = action === "renew" ? addDays(baseForRenewal, validityDays) : addDays(effectiveDate, validityDays);
    const existingCredits = Number(membership.creditsRemaining || 0);
    let payableAmount = 0;
    let creditNoteAmount = 0;
    let refundAmount = 0;
    if (action === "renew") {
      payableAmount = targetValue;
    } else if (action === "upgrade") {
      payableAmount = Math.max(delta, 0);
      creditNoteAmount = Math.max(money(-delta), 0);
    } else {
      payableAmount = Math.max(delta, 0);
      creditNoteAmount = Math.max(money(-delta), 0);
      refundAmount = creditNoteAmount;
    }
    const warnings = [];
    if (!currentExpiry) warnings.push("Current membership has no expiry date; unused value is treated as 0.");
    if (currentExpiry && effectiveDate > currentExpiry) warnings.push("Effective date is after current expiry; unused value is 0.");
    if (action !== "renew" && currentPlan.id && targetPlan.id && currentPlan.id === targetPlan.id) warnings.push("Target plan is the same as the current plan.");
    if (payableAmount <= 0 && (action === "renew" || action === "upgrade")) warnings.push("Zero payable lifecycle action requires a reason and manager review.");
    if (creditNoteAmount > 0) warnings.push("Credit note or refund approval should be captured before applying this change.");
    if (addCredits > 0) warnings.push(`${addCredits} extra credits will be carried forward with existing credits.`);
    const creditCarryForward = {
      existingCredits,
      addCredits,
      carryForwardCredits: existingCredits + addCredits,
      rule: "Unused active credits carry forward into the new membership state unless the branch policy overrides them.",
      expiresOn: newExpiryDate
    };
    const suggestedAction = this.prorationSuggestedAction(action, payableAmount, creditNoteAmount, refundAmount);
    return {
      action,
      currentPlan: compactPlan(currentPlan),
      targetPlan: compactPlan(targetPlan),
      currentExpiry,
      effectiveDate,
      startDate,
      usedDays,
      remainingDays,
      totalDays,
      unusedValue,
      targetValue,
      oldPrice: compactPlan(currentPlan).price,
      newPrice: compactPlan(targetPlan).price,
      priceDifference: money(Number(targetPlan.price || 0) - Number(currentPlan.price || 0)),
      proratedAdjustment: money(delta),
      payableAmount: money(payableAmount),
      creditNoteAmount: money(creditNoteAmount),
      refundAmount: money(refundAmount),
      creditNoteSuggestion: creditNoteAmount > 0 ? `Issue credit note of ₹${money(creditNoteAmount)} or approve refund before ${action}.` : "No credit note required.",
      newExpiryDate,
      creditCarryForward,
      suggestedAction,
      warnings
    };
  }

  lifecycleQuote(membership = {}, targetPlan = null, action = "upgrade") {
    const currentPlan = compactPlan({
      id: this.membershipPlanId(membership),
      name: membership.planName || "Membership",
      price: membership.price || 0,
      validityDays: targetPlan?.validityDays || 365,
      discountPercent: this.discountPercent(membership),
      productDiscountPercent: this.productDiscountPercent(membership)
    });
    const target = compactPlan(targetPlan || {});
    const remainingDays = membership.validityDate ? Math.max(this.daysLeft(membership.validityDate), 0) : Number(target.validityDays || 365);
    const totalDays = Math.max(Number(target.validityDays || currentPlan.validityDays || 365), 1);
    const unusedValue = money(Number(currentPlan.price || 0) * (remainingDays / totalDays));
    const targetValue = money(target.price || 0);
    const delta = money(targetValue - unusedValue);
    return {
      action,
      currentPlan,
      targetPlan: target,
      currentExpiry: membership.validityDate || "",
      remainingDays,
      unusedValue,
      targetValue,
      oldPrice: currentPlan.price,
      newPrice: target.price,
      priceDifference: money(target.price - currentPlan.price),
      proratedAdjustment: delta,
      payableAmount: action === "downgrade" ? Math.max(delta, 0) : Math.max(delta, 0),
      creditNoteAmount: action === "downgrade" ? Math.max(money(-delta), 0) : 0,
      refundAmount: action === "downgrade" ? Math.max(money(-delta), 0) : 0
    };
  }

  lifecyclePaymentContext(action, payload = {}, membership = {}, targetPlan = null, access = {}) {
    if (payload.confirmed !== true) {
      throw badRequest("Lifecycle confirmation drawer is required");
    }
    const mode = text(payload.paymentMode || (action === "cancel" ? "no_payment" : "cash"));
    if (!PAYMENT_MODES.has(mode)) throw badRequest("Valid paymentMode is required");
    const quote = ["renew", "upgrade", "downgrade"].includes(action)
      ? this.buildProrationPreview(membership, { ...payload, action, targetPlanId: payload.targetPlanId || payload.planId || targetPlan?.id || "" }, access)
      : null;
    const amount = money(payload.amount ?? payload.renewalAmount ?? payload.payableAmount ?? quote?.payableAmount ?? 0);
    const paidAmount = money(payload.paidAmount ?? payload.payableAmount ?? amount);
    const refundAmount = money(payload.refundAmount ?? payload.creditNoteAmount ?? quote?.refundAmount ?? 0);
    const zeroReason = text(payload.zeroReason || payload.reason);
    const reason = text(payload.reason || payload.note);
    const riskFlags = [];
    if (action === "cancel" && !reason) throw badRequest("Cancel reason is required");
    if ((action === "renew" || action === "upgrade") && paidAmount <= 0) {
      if (!zeroReason) throw badRequest("Zero amount renew/upgrade requires a reason");
      riskFlags.push({
        code: "zero_value_lifecycle",
        level: "high",
        reason: `Zero amount ${action} approved with reason: ${zeroReason}`
      });
    }
    if (action === "downgrade" && refundAmount > 0) {
      riskFlags.push({
        code: "downgrade_credit_note",
        level: "medium",
        reason: `Downgrade created refund/credit note amount ${refundAmount}`
      });
    }
    return {
      mode,
      referenceNo: text(payload.referenceNo),
      amount,
      paidAmount,
      refundAmount,
      creditNoteAmount: money(payload.creditNoteAmount ?? refundAmount),
      effectiveDate: payload.effectiveDate || today(),
      reason,
      zeroReason,
      quote,
      riskFlags,
      actor: {
        userId: access.userId || "",
        role: access.role || access.userRole || access.roleName || "",
        branchId: membership.branchId || access.requestedBranchId || access.branchId || "",
        timestamp: now()
      }
    };
  }

  createInvoiceSnapshot({ sale, invoice, membershipBenefit = {}, membershipRedeem = {} } = {}, access) {
    if (!invoice?.id || !invoice.clientId) return null;
    const membershipId = membershipBenefit.membership?.id || membershipRedeem.autoDiscountMembershipId || membershipRedeem.membershipId || "";
    if (!membershipId && !membershipBenefit.amount) return null;
    const membership = membershipId ? repositories.memberships.getById(membershipId, scope(access)) : null;
    const planId = membership ? this.membershipPlanId(membership) : "";
    const id = makeId("msnap");
    const row = {
      id,
      tenant_id: access.tenantId,
      branch_id: sale?.branchId || "",
      invoice_id: invoice.id,
      sale_id: sale?.id || "",
      client_id: invoice.clientId,
      membership_id: membershipId,
      plan_id: planId,
      plan_name: membership?.planName || "",
      discount_percent: Number(membershipBenefit.percent || membershipRedeem.autoDiscountPercent || 0),
      discount_amount: money(membershipBenefit.amount || membershipRedeem.autoDiscountAmount || 0),
      credits_used: Number(membershipRedeem.creditsUsed || 0),
      terms_json: stringify({ membership, membershipBenefit, membershipRedeem }, {}),
      invoice_total: money(invoice.total || 0),
      created_at: now()
    };
    db.prepare(
      `INSERT OR IGNORE INTO membership_invoice_snapshots
       (id, tenant_id, branch_id, invoice_id, sale_id, client_id, membership_id, plan_id, plan_name,
        discount_percent, discount_amount, credits_used, terms_json, invoice_total, created_at)
       VALUES
       (@id, @tenant_id, @branch_id, @invoice_id, @sale_id, @client_id, @membership_id, @plan_id, @plan_name,
        @discount_percent, @discount_amount, @credits_used, @terms_json, @invoice_total, @created_at)`
    ).run(row);
    if (row.discount_amount > 0 || row.credits_used > 0) {
      this.ledger({
        branchId: row.branch_id,
        clientId: row.client_id,
        membershipId,
        planId,
        invoiceId: row.invoice_id,
        saleId: row.sale_id,
        action: row.credits_used > 0 ? "redeemed" : "discount_applied",
        discountAmount: row.discount_amount,
        creditsBefore: Number(membership?.creditsRemaining || 0) + row.credits_used,
        creditsAfter: Number(membership?.creditsRemaining || 0),
        snapshot: row,
        note: "Invoice membership snapshot"
      }, access);
    }
    return row;
  }

  recordSoldEntitlements({ entitlements = [], sale = {}, invoice = {}, items = [] } = {}, access) {
    const records = [];
    for (const membership of entitlements.filter((item) => item?.planName)) {
      const sourceItem = items.find((item) => item.type === "membership" && item.name === membership.planName) || {};
      if (!sourceItem.id && !sourceItem.discountPercent) continue;
      const planId = sourceItem.id || this.membershipPlanId(membership);
      records.push(this.ledger({
        branchId: membership.branchId || sale.branchId || "",
        clientId: membership.clientId,
        membershipId: membership.id,
        planId,
        invoiceId: invoice.id || "",
        saleId: sale.id || "",
        action: "sold",
        amount: money(membership.price || sourceItem.price || 0),
        paidAmount: money(membership.price || sourceItem.price || 0),
        creditsBefore: 0,
        creditsAfter: Number(membership.creditsRemaining || 0),
        startsOn: sale.createdAt ? String(sale.createdAt).slice(0, 10) : today(),
        expiresOn: membership.validityDate || "",
        snapshot: { membership, sourceItem, invoiceId: invoice.id || "", staffId: sourceItem.staffId || sourceItem.staff_id || "", staffName: sourceItem.staffName || sourceItem.staff_name || "", commissionSource: "pos_invoice" },
        note: "Membership sold from POS"
      }, access));
      this.audit("membership.sold", "membership", membership.id, {}, {
        ...membership,
        planId,
        invoiceId: invoice.id || "",
        saleId: sale.id || "",
        staffId: sourceItem.staffId || sourceItem.staff_id || "",
        commissionSource: "pos_invoice"
      }, access, membership.branchId || sale.branchId || "");
    }
    return records;
  }

  currentMonthUsage(membership = {}) {
    const prefix = today().slice(0, 7);
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    return history
      .filter((item) => String(item?.date || item?.createdAt || "").slice(0, 7) === prefix)
      .reduce((sum, item) => sum + Math.max(1, Number(item?.creditsUsed || item?.credits || item?.quantity || 0)), 0);
  }

  tierSuggestionForClient(client = {}, plan = {}) {
    const rules = plan?.benefitRules || {};
    const tier = rules.tier || {};
    const spendThreshold = Number(tier.spendThreshold || 0);
    const visitThreshold = Number(tier.visitThreshold || 0);
    const totalSpend = Number(client.totalSpend || client.total_spend || 0);
    const visitCount = Number(client.visitCount || client.visit_count || 0);
    const eligible = Boolean((spendThreshold > 0 && totalSpend >= spendThreshold) || (visitThreshold > 0 && visitCount >= visitThreshold));
    return {
      eligible,
      tierName: tier.name || plan.name || "",
      spendThreshold,
      visitThreshold,
      totalSpend,
      visitCount,
      gapSpend: Math.max(0, spendThreshold - totalSpend),
      gapVisits: Math.max(0, visitThreshold - visitCount)
    };
  }

  discountPercent(membership = {}) {
    const credits = Array.isArray(membership.serviceCredits) ? membership.serviceCredits : [];
    return Number(credits.find((item) => item?.type === "bill_discount")?.percent || 0);
  }

  productDiscountPercent(membership = {}) {
    const credits = Array.isArray(membership.serviceCredits) ? membership.serviceCredits : [];
    return Number(credits.find((item) => item?.type === "product_discount")?.percent || 0);
  }

  membershipWalletSnapshot(membership = {}, viewerClientId = "", familyRows = [], access = {}) {
    const plan = this.resolveMembershipPlan(membership, access);
    const client = repositories.clients.getById(membership.clientId, scope(access)) || {};
    const planType = planTypeFromRules(plan);
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const totalCredits = Math.max(Number(membership.planCredits || 0), Number(membership.creditsRemaining || 0), 0);
    const remainingCredits = Math.max(Number(membership.creditsRemaining || 0), 0);
    const historyUsed = history.reduce((sum, item) => sum + Number(item?.credits || item?.creditsUsed || 0), 0);
    const usedCredits = Math.max(totalCredits - remainingCredits, historyUsed, 0);
    const ownedByViewer = membership.clientId === viewerClientId;
    const sharingRows = familyRows.filter((row) => row.primary_client_id === membership.clientId || row.member_client_id === membership.clientId);
    const entitlementType = entitlementTypeFromMembership(membership);
    const prepaidCredit = Array.isArray(membership.serviceCredits)
      ? membership.serviceCredits.find((credit) => credit?.type === "prepaid_credit")
      : null;
    const creditRules = prepaidCredit?.benefitRules && typeof prepaidCredit.benefitRules === "object" ? prepaidCredit.benefitRules : {};
    const benefitRules = { ...(plan.benefitRules || {}), ...creditRules };
    const fairUsage = benefitRules.fairUsage || {};
    const monthlyCap = Math.max(0, Number(fairUsage.monthlyCap || 0));
    const monthlyUsed = planType === "unlimited" ? this.currentMonthUsage(membership) : 0;
    const monthlyRemaining = monthlyCap > 0 ? Math.max(0, monthlyCap - monthlyUsed) : remainingCredits;
    const effectiveRemaining = planType === "unlimited" ? monthlyRemaining : remainingCredits;
    return {
      membershipId: membership.id,
      clientId: membership.clientId,
      ownedByViewer,
      shareSource: ownedByViewer ? "own" : "family",
      entitlementType,
      planType,
      businessLabel: planBusinessLabel(plan, planType),
      membership,
      planId: plan.id || this.membershipPlanId(membership),
      planName: membership.planName || plan.name || "Membership",
      status: membership.status || "active",
      isActive: membership.status !== "expired" && membership.status !== "cancelled" && (!membership.validityDate || membership.validityDate >= today()),
      expiryDate: membership.validityDate || "",
      autoRenew: Boolean(Number(membership.autoRenew || 0)),
      planBenefits: {
        serviceDiscountPercent: Number(this.discountPercent(membership) || plan.discountPercent || 0),
        productDiscountPercent: Number(this.productDiscountPercent(membership) || plan.productDiscountPercent || 0),
        includedServices: plan.includedServices || [],
        benefitRules
      },
      serviceCredits: {
        total: totalCredits,
        used: usedCredits,
        remaining: effectiveRemaining,
        rawRemaining: remainingCredits,
        history: history.filter((item) => Number(item?.credits || item?.creditsUsed || 0) > 0).slice(0, 10)
      },
      fairUsage: {
        monthlyCap,
        monthlyUsed,
        monthlyRemaining,
        status: monthlyCap > 0 && monthlyRemaining <= 0 ? "limit_reached" : monthlyCap > 0 && monthlyRemaining <= 1 ? "near_limit" : "available"
      },
      corporate: benefitRules.corporate || {},
      occasionBenefits: benefitRules.occasionBenefits || {},
      priorityBooking: Boolean(benefitRules.priorityBooking),
      tierSuggestion: this.tierSuggestionForClient(client, plan),
      familySharing: {
        enabled: sharingRows.length > 0,
        role: ownedByViewer ? "owner" : "shared_member",
        linkedClientIds: [...new Set(sharingRows.flatMap((row) => [row.primary_client_id, row.member_client_id]).filter((id) => id && id !== membership.clientId))]
      }
    };
  }

  resolveMembershipPlan(membership = {}, access = {}) {
    const planId = this.membershipPlanId(membership);
    if (planId) {
      try {
        return this.getPlan(planId, access);
      } catch {
        // Old membership records may not point to a current plan master row.
      }
    }
    const validityDays = membership.validityDate
      ? Math.max(daysBetween(this.membershipStartDate(membership), membership.validityDate), 1)
      : 365;
    return {
      id: planId,
      name: membership.planName || "Membership",
      price: money(membership.price || 0),
      validityDays,
      discountPercent: this.discountPercent(membership),
      productDiscountPercent: this.productDiscountPercent(membership)
    };
  }

  membershipStartDate(membership = {}) {
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const lifecycleEvent = history.find((item) => item?.date && ["membership_sale", "manual_membership_assignment", "membership_renew"].includes(item?.type));
    return dateOnly(lifecycleEvent?.date || membership.createdAt || membership.created_at || today());
  }

  membershipPlanId(membership = {}) {
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const credits = Array.isArray(membership.serviceCredits) ? membership.serviceCredits : [];
    return history.find((item) => item?.planId)?.planId || credits.find((item) => item?.planId)?.planId || "";
  }

  familySharingRows(clientId, access) {
    return db.prepare(
      `SELECT * FROM membership_family_members
       WHERE tenant_id = ? AND status = 'active' AND share_benefits = 1
         AND (primary_client_id = ? OR member_client_id = ?)`
    ).all(access.tenantId, clientId, clientId);
  }

  prorationSuggestedAction(action, payableAmount, creditNoteAmount, refundAmount) {
    if (action === "renew") {
      return payableAmount > 0 ? "Collect renewal payment, then extend membership validity." : "Capture zero-renewal reason and manager approval before renewing.";
    }
    if (action === "upgrade") {
      if (payableAmount > 0) return "Collect upgrade difference before switching the plan.";
      if (creditNoteAmount > 0) return "Create a credit note for unused value before applying upgrade.";
      return "No payment difference; confirm reason before switching plan.";
    }
    if (refundAmount > 0) return "Approve refund or issue credit note before downgrading.";
    if (payableAmount > 0) return "Collect payable difference before downgrading.";
    return "Confirm downgrade with no payment difference.";
  }

  daysLeft(date) {
    return Math.ceil((new Date(date).getTime() - new Date(today()).getTime()) / 86400000);
  }

  familyMemberClientIds(clientId, access) {
    const rows = db.prepare(
      `SELECT primary_client_id, member_client_id FROM membership_family_members
       WHERE tenant_id = ? AND status = 'active' AND share_benefits = 1
         AND (primary_client_id = ? OR member_client_id = ?)`
    ).all(access.tenantId, clientId, clientId);
    return [...new Set(rows.flatMap((row) => [row.primary_client_id, row.member_client_id]).filter((id) => id && id !== clientId))];
  }

  ledger(payload = {}, access) {
    const id = makeId("mled");
    const row = {
      id,
      tenant_id: access.tenantId,
      branch_id: payload.branchId || "",
      client_id: payload.clientId || "",
      membership_id: payload.membershipId || "",
      plan_id: payload.planId || "",
      invoice_id: payload.invoiceId || "",
      sale_id: payload.saleId || "",
      action: payload.action || "note",
      amount: money(payload.amount || 0),
      paid_amount: money(payload.paidAmount || 0),
      discount_amount: money(payload.discountAmount || 0),
      credits_before: Number(payload.creditsBefore || 0),
      credits_after: Number(payload.creditsAfter || 0),
      starts_on: payload.startsOn || "",
      expires_on: payload.expiresOn || "",
      snapshot_json: stringify(payload.snapshot || {}, {}),
      note: payload.note || "",
      actor_user_id: access.userId || "",
      created_at: now()
    };
    db.prepare(
      `INSERT INTO client_membership_ledger
       (id, tenant_id, branch_id, client_id, membership_id, plan_id, invoice_id, sale_id, action, amount, paid_amount,
        discount_amount, credits_before, credits_after, starts_on, expires_on, snapshot_json, note, actor_user_id, created_at)
       VALUES
       (@id, @tenant_id, @branch_id, @client_id, @membership_id, @plan_id, @invoice_id, @sale_id, @action, @amount, @paid_amount,
        @discount_amount, @credits_before, @credits_after, @starts_on, @expires_on, @snapshot_json, @note, @actor_user_id, @created_at)`
    ).run(row);
    return rowToLedger(row);
  }

  scheduleRenewalReminders(membership, plan, access) {
    if (!membership?.validityDate) return [];
    const client = repositories.clients.getById(membership.clientId, scope(access));
    return [30, 15, 7, 1].map((daysBefore) => this.createReminder(membership, plan, client, daysBefore, addDays(membership.validityDate, -daysBefore), access)).filter(Boolean);
  }

  createReminder(membership, plan, client, daysBefore, dueOn, access) {
    if (!membership?.validityDate || !client) return null;
    return this.createTypedReminder({
      membership,
      plan,
      client,
      reminderType: "renewal",
      dueOn,
      daysBefore,
      message: `Hi ${client.name || "there"}, your ${membership.planName} membership expires on ${membership.validityDate}. Reply to renew.`,
      payload: { phone: client.phone || "", membershipName: membership.planName, expiresOn: membership.validityDate }
    }, access);
  }

  createTypedReminder({ membership, plan, client, reminderType = "renewal", dueOn = today(), daysBefore = 0, message = "", payload = {} } = {}, access) {
    if (!membership?.id || !client) return null;
    const existing = db.prepare(
      `SELECT id FROM membership_whatsapp_reminders
       WHERE tenant_id = ? AND client_id = ? AND membership_id = ? AND reminder_type = ? AND due_on = ?`
    ).get(access.tenantId, client.id, membership.id, reminderType, dueOn);
    if (existing) return null;
    const row = {
      id: makeId("mwa"),
      tenant_id: access.tenantId,
      branch_id: membership.branchId || client.branchId || "",
      client_id: client.id,
      membership_id: membership.id,
      plan_id: plan?.id || this.membershipPlanId(membership),
      reminder_type: reminderType,
      due_on: dueOn,
      days_before: daysBefore,
      status: "queued",
      message,
      payload_json: stringify({ phone: client.phone || "", membershipName: membership.planName, ...payload }, {}),
      approved_by: "",
      sent_at: "",
      created_at: now(),
      updated_at: now()
    };
    db.prepare(
      `INSERT INTO membership_whatsapp_reminders
       (id, tenant_id, branch_id, client_id, membership_id, plan_id, reminder_type, due_on, days_before, status, message,
        payload_json, approved_by, sent_at, created_at, updated_at)
       VALUES
       (@id, @tenant_id, @branch_id, @client_id, @membership_id, @plan_id, @reminder_type, @due_on, @days_before, @status, @message,
        @payload_json, @approved_by, @sent_at, @created_at, @updated_at)`
    ).run(row);
    return rowToReminder(row);
  }

  autoRenewQueueItem(membership, access) {
    const client = repositories.clients.getById(membership.clientId, scope(access));
    const plan = this.resolveMembershipPlan(membership, access);
    const auditState = this.autoRenewAuditState(membership.id, access);
    const daysLeft = membership.validityDate ? Math.ceil((dateMs(membership.validityDate) - dateMs(today())) / 86400000) : 99999;
    const autoRenewEnabled = Boolean(Number(membership.autoRenew || 0));
    const paused = !autoRenewEnabled;
    const failedPayment = auditState.latestRetry?.action === "membership.auto_renew.retry_failed" && auditState.latestRetry?.after?.status === "failed";
    const paymentMethod = this.autoRenewPaymentMethod(membership, client, plan, auditState.latestRetry?.after?.paymentMethod || {});
    const reminder = this.latestReminderForMembership(membership.id, access);
    let bucket = "future";
    if (daysLeft < 0) bucket = "overdue";
    else if (daysLeft === 0) bucket = "due_today";
    else if (daysLeft <= 7) bucket = "due_in_7_days";
    let status = bucket;
    if (paused) status = "paused";
    else if (failedPayment) status = "failed_payment";
    else if (paymentMethod.status === "missing") status = "payment_method_missing";
    else if (paymentMethod.providerReady === false) status = "provider_not_ready";
    return {
      membershipId: membership.id,
      clientId: membership.clientId,
      clientName: client?.name || membership.clientName || membership.clientId,
      planId: plan.id || this.membershipPlanId(membership),
      planName: membership.planName || plan.name || "Membership",
      branchId: membership.branchId || client?.branchId || "",
      price: money(membership.price || plan.price || 0),
      expiresOn: membership.validityDate || "",
      daysLeft,
      bucket,
      status,
      autoRenewEnabled,
      paused,
      failedPayment,
      retryCount: auditState.retryCount,
      lastRetryAt: auditState.latestRetry?.createdAt || "",
      nextRetryAt: auditState.latestRetry?.after?.nextRetryAt || "",
      failureReason: auditState.latestRetry?.after?.failureReason || "",
      paymentMethod,
      whatsappReminderStatus: reminder?.status || "not_queued",
      whatsappReminderId: reminder?.id || "",
      whatsappReminderDueOn: reminder?.dueOn || "",
      suggestedAction: this.autoRenewSuggestedAction({ paused, failedPayment, paymentMethod, daysLeft }),
      sortScore: (failedPayment ? 0 : paused ? 5 : paymentMethod.status === "missing" ? 10 : daysLeft < 0 ? 15 : daysLeft)
    };
  }

  autoRenewPaymentMethod(membership = {}, client = {}, plan = {}, override = {}) {
    const history = Array.isArray(membership.redeemHistory) ? membership.redeemHistory : [];
    const reusable = override?.token || override?.mandateId || override?.savedPaymentMethodId || membership.autoRenewPaymentMethodId;
    const lastPayment = history.find((item) => item?.paymentMode && !["no_payment", "credit_due"].includes(item.paymentMode));
    if (reusable) {
      return {
        status: "placeholder",
        label: override.label || "Saved payment method placeholder",
        provider: override.provider || "not_configured",
        providerReady: false,
        savedPaymentMethodId: override.savedPaymentMethodId || membership.autoRenewPaymentMethodId || "",
        mandateId: override.mandateId || ""
      };
    }
    return {
      status: "missing",
      label: "No saved card/UPI mandate",
      provider: "not_configured",
      providerReady: false,
      lastPaymentMode: lastPayment?.paymentMode || "",
      clientPhone: client?.phone || "",
      planName: plan?.name || membership.planName || ""
    };
  }

  autoRenewSuggestedAction({ paused, failedPayment, paymentMethod, daysLeft }) {
    if (paused) return "Resume auto-renew only after client confirms.";
    if (failedPayment) return "Call client, update payment method, then retry manually.";
    if (paymentMethod.status === "missing") return "Send WhatsApp reminder to collect payment method before charging.";
    if (paymentMethod.providerReady === false) return "Connect payment provider before running auto-renew.";
    if (daysLeft <= 0) return "Review today and renew through payment drawer.";
    return "Monitor renewal window.";
  }

  latestReminderForMembership(membershipId, access) {
    const row = db.prepare(
      `SELECT * FROM membership_whatsapp_reminders
       WHERE tenant_id = ? AND membership_id = ?
       ORDER BY due_on ASC, created_at DESC
       LIMIT 1`
    ).get(access.tenantId, membershipId);
    return row ? rowToReminder(row) : null;
  }

  createAutoRenewReminder(membership, client, plan, reason, nextRetryAt, access) {
    if (!membership?.id || !client) return null;
    const dueOn = dateOnly(nextRetryAt || today());
    const reminderType = reason === "payment_method_missing" ? "auto_renew_payment_method" : "auto_renew_retry";
    const existing = db.prepare(
      `SELECT * FROM membership_whatsapp_reminders
       WHERE tenant_id = ? AND client_id = ? AND membership_id = ? AND reminder_type = ? AND due_on = ?`
    ).get(access.tenantId, client.id, membership.id, reminderType, dueOn);
    if (existing) return rowToReminder(existing);
    const message = reason === "payment_method_missing"
      ? `Hi ${client.name || "there"}, your ${membership.planName} auto-renew needs a saved payment method before ${membership.validityDate}.`
      : `Hi ${client.name || "there"}, your ${membership.planName} auto-renew needs confirmation before ${membership.validityDate}.`;
    const row = {
      id: makeId("mwa"),
      tenant_id: access.tenantId,
      branch_id: membership.branchId || client.branchId || "",
      client_id: client.id,
      membership_id: membership.id,
      plan_id: plan?.id || this.membershipPlanId(membership),
      reminder_type: reminderType,
      due_on: dueOn,
      days_before: Number.isFinite(Number(membership.validityDate ? daysBetween(today(), membership.validityDate) : 0)) ? Number(membership.validityDate ? daysBetween(today(), membership.validityDate) : 0) : 0,
      status: "queued",
      message,
      payload_json: stringify({ phone: client.phone || "", reason, nextRetryAt, membershipName: membership.planName, expiresOn: membership.validityDate }, {}),
      approved_by: "",
      sent_at: "",
      created_at: now(),
      updated_at: now()
    };
    db.prepare(
      `INSERT INTO membership_whatsapp_reminders
       (id, tenant_id, branch_id, client_id, membership_id, plan_id, reminder_type, due_on, days_before, status, message,
        payload_json, approved_by, sent_at, created_at, updated_at)
       VALUES
       (@id, @tenant_id, @branch_id, @client_id, @membership_id, @plan_id, @reminder_type, @due_on, @days_before, @status, @message,
        @payload_json, @approved_by, @sent_at, @created_at, @updated_at)`
    ).run(row);
    return rowToReminder(row);
  }

  autoRenewAuditState(membershipId, access) {
    const rows = db.prepare(
      `SELECT * FROM membership_audit_logs
       WHERE tenant_id = ? AND target_type = 'membership' AND target_id = ? AND action LIKE 'membership.auto_renew.%'
       ORDER BY created_at DESC`
    ).all(access.tenantId, membershipId).map((row) => ({
      id: row.id,
      action: row.action,
      before: json(row.before_json, {}),
      after: json(row.after_json, {}),
      createdAt: row.created_at
    }));
    const retryRows = rows.filter((row) => row.action === "membership.auto_renew.retry_failed");
    return {
      rows,
      retryCount: retryRows.length,
      latestRetry: retryRows[0] || null
    };
  }

  audit(action, targetType, targetId, before, after, access, branchId = "") {
    const row = {
      id: makeId("maudit"),
      tenant_id: access.tenantId,
      branch_id: branchId,
      actor_user_id: access.userId || "",
      action,
      target_type: targetType,
      target_id: targetId,
      before_json: stringify(before || {}, {}),
      after_json: stringify(after || {}, {}),
      reason: "",
      created_at: now()
    };
    db.prepare(
      `INSERT INTO membership_audit_logs
       (id, tenant_id, branch_id, actor_user_id, action, target_type, target_id, before_json, after_json, reason, created_at)
       VALUES
       (@id, @tenant_id, @branch_id, @actor_user_id, @action, @target_type, @target_id, @before_json, @after_json, @reason, @created_at)`
    ).run(row);
    securityService.audit({ action, targetType, targetId, details: { branchId } }, access);
    return row;
  }
}

export const membershipEnterpriseService = new MembershipEnterpriseService();
