import { db } from "../db.js";
import { happyHoursControlTowerRepo } from "./happy-hours-control-tower.repo.js";

const OFFER_TYPES = new Set(["generic", "first_visit", "referral", "branch_specific", "service_specific", "segment"]);
const STATUSES = new Set(["draft", "active", "paused", "expired", "archived"]);
const DISCOUNT_TYPES = new Set(["percent", "flat"]);

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function intValue(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function idFrom(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function codeValue(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

function csvList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonText(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value);
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
  } catch {
    return false;
  }
}

function columns(tableName) {
  if (!tableExists(tableName)) return [];
  try {
    return db.prepare(`PRAGMA table_info("${String(tableName).replace(/"/g, "\"\"")}")`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function firstColumn(tableName, candidates) {
  const available = columns(tableName);
  return candidates.find((candidate) => available.includes(candidate)) || "";
}

function q(identifier) {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function couponByCode(scope = {}) {
  const current = requireScope(scope);
  const code = codeValue(scope.code);
  if (!code) return null;
  const row = db.prepare(`
    SELECT *
    FROM discountCoupons
    WHERE tenantId = @tenantId AND branchId = @branchId AND code = @code
    LIMIT 1
  `).get({ ...current, code });
  return parseCoupon(row);
}

function couponById(scope = {}) {
  const current = requireScope(scope);
  const id = idFrom(scope.id);
  if (!id) return null;
  return parseCoupon(db.prepare(`
    SELECT *
    FROM discountCoupons
    WHERE tenantId = @tenantId AND branchId = @branchId AND id = @id
    LIMIT 1
  `).get({ ...current, id }));
}

function parseCoupon(row) {
  if (!row) return null;
  const target = parseJson(row.targetJson, {});
  return {
    ...row,
    discountValue: Number(row.discountValue || 0),
    maxDiscountPaise: intPaise(row.maxDiscountPaise),
    usageLimit: Number(row.usageLimit || 0),
    perClientLimit: Number(row.perClientLimit || 0),
    usedCount: Number(row.usedCount || 0),
    target,
    offerType: target.offerType || "generic"
  };
}

function normalizeTarget(data = {}) {
  const offerType = OFFER_TYPES.has(data.offerType) ? data.offerType : "generic";
  const minCartPaise = intPaise(data.minCartPaise);
  const serviceCategories = csvList(data.serviceCategories);
  const serviceIds = csvList(data.serviceIds);
  const branchIds = csvList(data.branchIds || data.allowedBranchIds);
  return {
    ...(data.target && typeof data.target === "object" ? data.target : {}),
    offerType,
    clientSegment: String(data.clientSegment || data.target?.clientSegment || "").trim(),
    minCartPaise,
    serviceCategories,
    serviceIds,
    branchIds,
    firstVisitOnly: Boolean(data.firstVisitOnly || offerType === "first_visit"),
    referralRequired: Boolean(data.referralRequired || offerType === "referral"),
    publicVisible: Boolean(data.publicVisible || data.target?.publicVisible),
    notes: String(data.notes || data.target?.notes || "").trim()
  };
}

function normalizeCouponPayload(data = {}) {
  const discountType = DISCOUNT_TYPES.has(data.discountType) ? data.discountType : "percent";
  const offerType = OFFER_TYPES.has(data.offerType) ? data.offerType : "generic";
  return {
    ...requireScope(data),
    id: idFrom(data.id),
    code: codeValue(data.code),
    title: String(data.title || data.code || "Coupon").trim().slice(0, 160),
    discountType,
    discountValue: Math.max(0, intValue(data.discountValue ?? data.value, 0)),
    maxDiscountPaise: intPaise(data.maxDiscountPaise),
    usageLimit: Math.max(0, intValue(data.usageLimit, 0)),
    perClientLimit: Math.max(1, intValue(data.perClientLimit, 1)),
    validFrom: data.validFrom || null,
    validTo: data.validTo || null,
    status: STATUSES.has(data.status) ? data.status : "draft",
    target: normalizeTarget({ ...data, offerType }),
    createdBy: data.createdBy || null
  };
}

function currentDate(value) {
  return String(value || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)).slice(0, 10);
}

function activeDate(coupon, date) {
  return (!coupon.validFrom || coupon.validFrom <= date) && (!coupon.validTo || coupon.validTo >= date);
}

function countClientVisits({ tenantId, branchId, clientId }) {
  const client = String(clientId || "").trim();
  if (!client) return null;
  let count = 0;
  for (const tableName of ["invoices", "appointments", "billing"]) {
    if (!tableExists(tableName)) continue;
    const tenantCol = firstColumn(tableName, ["tenantId", "tenant_id"]);
    const branchCol = firstColumn(tableName, ["branchId", "branch_id"]);
    const clientCol = firstColumn(tableName, ["clientId", "client_id", "customerId", "customer_id"]);
    if (!tenantCol || !branchCol || !clientCol) continue;
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM ${q(tableName)}
        WHERE ${q(tenantCol)} = @tenantId
          AND ${q(branchCol)} = @branchId
          AND ${q(clientCol)} = @clientId
      `).get({ tenantId, branchId, clientId: client });
      count += Number(row?.count || 0);
    } catch {
      // optional legacy source; ignore safely
    }
  }
  return count;
}

function usageForClient({ tenantId, branchId, couponId, clientId }) {
  if (!clientId) return 0;
  const row = db.prepare(`
    SELECT COUNT(*) AS used
    FROM discountCouponUsage
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND couponId = @couponId
      AND clientId = @clientId
  `).get({ tenantId, branchId, couponId, clientId });
  return Number(row?.used || 0);
}

function contextCategories(data = {}) {
  const categories = new Set(csvList(data.serviceCategories || data.serviceCategory));
  for (const item of Array.isArray(data.cartItems) ? data.cartItems : []) {
    if (item.categoryId) categories.add(String(item.categoryId));
    if (item.category) categories.add(String(item.category));
    if (item.serviceCategory) categories.add(String(item.serviceCategory));
  }
  return categories;
}

function contextServiceIds(data = {}) {
  const ids = new Set(csvList(data.serviceIds || data.serviceId));
  for (const item of Array.isArray(data.cartItems) ? data.cartItems : []) {
    if (item.serviceId) ids.add(String(item.serviceId));
    if (item.itemId) ids.add(String(item.itemId));
  }
  return ids;
}

function targetCheck(coupon, data = {}) {
  const target = coupon.target || {};
  const branchIds = csvList(target.branchIds);
  if (branchIds.length && !branchIds.includes(coupon.branchId)) return "coupon_branch_not_eligible";

  const cartTotalPaise = intPaise(data.cartTotalPaise ?? data.amountPaise);
  if (intPaise(target.minCartPaise) > 0 && cartTotalPaise < intPaise(target.minCartPaise)) return "coupon_min_cart_not_met";

  const requiredCategories = csvList(target.serviceCategories);
  if (requiredCategories.length) {
    const actual = contextCategories(data);
    if (!requiredCategories.some((category) => actual.has(category))) return "coupon_service_category_not_eligible";
  }

  const requiredServices = csvList(target.serviceIds);
  if (requiredServices.length) {
    const actual = contextServiceIds(data);
    if (!requiredServices.some((serviceId) => actual.has(serviceId))) return "coupon_service_not_eligible";
  }

  if (target.firstVisitOnly) {
    const visitCount = data.clientVisitCount !== undefined ? Number(data.clientVisitCount || 0) : countClientVisits({ ...coupon, clientId: data.clientId });
    if (data.isFirstVisit !== true && visitCount !== 0) return "coupon_first_visit_only";
  }

  if (target.referralRequired && !data.referralClientId && !data.referralCode) return "coupon_referral_required";

  const clientSegment = String(target.clientSegment || "").trim();
  if (clientSegment && String(data.clientSegment || "").trim() !== clientSegment) return "coupon_segment_not_eligible";

  return "";
}

function discountFor(coupon, data = {}) {
  const cartTotalPaise = intPaise(data.cartTotalPaise ?? data.amountPaise);
  const attempted = coupon.discountType === "flat"
    ? intPaise(coupon.discountValue)
    : Math.round((cartTotalPaise * Number(coupon.discountValue || 0)) / 100);
  const capped = coupon.maxDiscountPaise > 0 ? Math.min(attempted, coupon.maxDiscountPaise) : attempted;
  return Math.min(cartTotalPaise, capped);
}

export function createCoupon(data = {}) {
  const payload = normalizeCouponPayload(data);
  return happyHoursControlTowerRepo.saveCoupon({
    ...payload,
    target: payload.target
  });
}

export function updateCoupon(data = {}) {
  const payload = normalizeCouponPayload(data);
  if (!payload.id) throw new Error("valid coupon id is required");
  return happyHoursControlTowerRepo.updateCoupon({
    ...payload,
    target: payload.target
  });
}

export function listCoupons(scope = {}) {
  const result = happyHoursControlTowerRepo.listCoupons(scope);
  const offerType = String(scope.offerType || "").trim();
  return {
    ...result,
    rows: result.rows.filter((row) => !offerType || row.target?.offerType === offerType)
  };
}

export function validateCoupon(data = {}) {
  const current = requireScope(data);
  const coupon = couponByCode({ ...current, code: data.code });
  if (!coupon) return { valid: false, reason: "coupon_not_found", discountPaise: 0 };
  const date = currentDate(data.currentDate);
  if (coupon.status !== "active") return { valid: false, reason: "coupon_not_active", coupon, discountPaise: 0 };
  if (!activeDate(coupon, date)) return { valid: false, reason: "coupon_outside_validity", coupon, discountPaise: 0 };
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) return { valid: false, reason: "coupon_usage_limit_reached", coupon, discountPaise: 0 };
  const clientId = String(data.clientId || "").trim();
  if (clientId && coupon.perClientLimit > 0 && usageForClient({ ...current, couponId: coupon.id, clientId }) >= coupon.perClientLimit) {
    return { valid: false, reason: "coupon_client_limit_reached", coupon, discountPaise: 0 };
  }
  const targetReason = targetCheck(coupon, data);
  if (targetReason) return { valid: false, reason: targetReason, coupon, discountPaise: 0 };
  const discountPaise = discountFor(coupon, data);
  return {
    valid: true,
    reason: "coupon_valid",
    coupon,
    discountPaise,
    payablePaise: Math.max(0, intPaise(data.cartTotalPaise ?? data.amountPaise) - discountPaise)
  };
}

export function redeemCoupon(data = {}) {
  const validation = validateCoupon(data);
  if (!validation.valid) return { ...validation, recorded: false };
  const coupon = validation.coupon;
  const result = happyHoursControlTowerRepo.recordCouponUse({
    ...data,
    code: coupon.code,
    couponId: coupon.id,
    discountPaise: validation.discountPaise,
    metadata: {
      ...(data.metadata && typeof data.metadata === "object" ? data.metadata : {}),
      couponEngine: true,
      offerType: coupon.target?.offerType || "generic",
      referralClientId: data.referralClientId || null,
      referralCode: data.referralCode || null
    }
  });
  if (result.recorded) {
    try {
      happyHoursControlTowerRepo.recordRoiOutcome({
        ...requireScope(data),
        couponId: coupon.id,
        clientId: data.clientId || "",
        invoiceId: data.invoiceId || "",
        amountPaise: intPaise(data.cartTotalPaise ?? data.amountPaise),
        discountPaise: validation.discountPaise,
        grossMarginPaise: intPaise(data.grossMarginPaise),
        repeatClient: Boolean(data.repeatClient),
        source: "coupon_engine",
        metadata: { offerType: coupon.target?.offerType || "generic" }
      });
    } catch {
      // ROI tracking is best-effort; coupon redemption must not fail because of reporting.
    }
  }
  return { ...result, coupon: couponById({ ...data, id: coupon.id }) || coupon };
}

export function analytics(scope = {}) {
  const current = requireScope(scope);
  const rows = db.prepare(`
    SELECT c.*,
           COUNT(u.id) AS redemptionCount,
           COALESCE(SUM(u.amountPaise), 0) AS grossRevenuePaise,
           COALESCE(SUM(u.discountPaise), 0) AS totalDiscountPaise,
           COUNT(DISTINCT NULLIF(u.clientId, '')) AS uniqueClients
    FROM discountCoupons c
    LEFT JOIN discountCouponUsage u
      ON u.tenantId = c.tenantId
     AND u.branchId = c.branchId
     AND u.couponId = c.id
    WHERE c.tenantId = @tenantId
      AND c.branchId = @branchId
    GROUP BY c.id
    ORDER BY redemptionCount DESC, c.createdAt DESC
    LIMIT 200
  `).all(current).map((row) => {
    const coupon = parseCoupon(row);
    const grossRevenuePaise = intPaise(row.grossRevenuePaise);
    const totalDiscountPaise = intPaise(row.totalDiscountPaise);
    return {
      ...coupon,
      redemptionCount: Number(row.redemptionCount || 0),
      uniqueClients: Number(row.uniqueClients || 0),
      grossRevenuePaise,
      totalDiscountPaise,
      netRevenuePaise: Math.max(0, grossRevenuePaise - totalDiscountPaise),
      returnOnDiscountPercent: totalDiscountPaise ? Math.round(((grossRevenuePaise - totalDiscountPaise) * 10000) / totalDiscountPaise) / 100 : 0
    };
  });
  return {
    ...current,
    rows,
    summary: rows.reduce((acc, row) => {
      acc.coupons += 1;
      if (row.status === "active") acc.activeCoupons += 1;
      acc.redemptions += row.redemptionCount;
      acc.grossRevenuePaise += row.grossRevenuePaise;
      acc.totalDiscountPaise += row.totalDiscountPaise;
      acc.netRevenuePaise += row.netRevenuePaise;
      return acc;
    }, { coupons: 0, activeCoupons: 0, redemptions: 0, grossRevenuePaise: 0, totalDiscountPaise: 0, netRevenuePaise: 0 })
  };
}

export function templates() {
  return [
    { offerType: "generic", code: "MONDAY20", title: "Monday Happy Hours", discountType: "percent", discountValue: 20 },
    { offerType: "first_visit", code: "FIRSTVISIT", title: "First Visit Welcome", discountType: "percent", discountValue: 15, firstVisitOnly: true },
    { offerType: "referral", code: "REFER10", title: "Referral Thank You", discountType: "percent", discountValue: 10, referralRequired: true },
    { offerType: "branch_specific", code: "BRANCH15", title: "Branch Special", discountType: "percent", discountValue: 15 },
    { offerType: "service_specific", code: "SPA500", title: "Spa Flat Discount", discountType: "flat", discountValue: 50000, serviceCategories: "spa" }
  ];
}

export const couponEngineRepo = {
  createCoupon,
  updateCoupon,
  listCoupons,
  validateCoupon,
  redeemCoupon,
  analytics,
  templates
};
