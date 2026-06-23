import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursBundleAwareSuggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    serviceCategory TEXT NOT NULL DEFAULT 'default',
    primaryServiceId TEXT NOT NULL DEFAULT '',
    signalDate TEXT NOT NULL,
    dayOfWeek TEXT NOT NULL DEFAULT '',
    hourSlot INTEGER NOT NULL DEFAULT 0,
    selectedServiceCount INTEGER NOT NULL DEFAULT 1,
    cartTotalPaise INTEGER NOT NULL DEFAULT 0,
    baseDiscountPercent REAL NOT NULL DEFAULT 0,
    bundleMarginPercent REAL NOT NULL DEFAULT 0,
    addOnAttachRatePercent REAL NOT NULL DEFAULT 0,
    targetTicketLiftPaise INTEGER NOT NULL DEFAULT 0,
    packageEligible INTEGER NOT NULL DEFAULT 0,
    packagePricePaise INTEGER NOT NULL DEFAULT 0,
    candidateAddOnCount INTEGER NOT NULL DEFAULT 0,
    candidatePackageCount INTEGER NOT NULL DEFAULT 0,
    avgCatalogPricePaise INTEGER NOT NULL DEFAULT 0,
    bundleOpportunity TEXT NOT NULL DEFAULT 'unknown',
    marginPosture TEXT NOT NULL DEFAULT 'unknown',
    campaignAngle TEXT NOT NULL DEFAULT 'collect_bundle_data',
    suggestedDiscountPercent INTEGER NOT NULL DEFAULT 0,
    expectedDiscountPaise INTEGER NOT NULL DEFAULT 0,
    suggestedBundlePricePaise INTEGER NOT NULL DEFAULT 0,
    expectedNetRevenuePaise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'suggested',
    reasons TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bundleAwareSuggestions_scope
    ON happyHoursBundleAwareSuggestions(tenantId, branchId, status, serviceCategory, createdAt);
`);

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function cleanCategory(value) {
  return String(value || "default").trim().toLowerCase() || "default";
}

function intPaise(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function percent(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function boolInt(value) {
  return value === true || value === "true" || value === 1 || value === "1" ? 1 : 0;
}

function q(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe identifier");
  return `"${identifier}"`;
}

function tableExists(tableName) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @tableName").get({ tableName }));
  } catch {
    return false;
  }
}

function safeColumns(tableName) {
  if (!tableExists(tableName)) return [];
  try {
    return db.prepare(`PRAGMA table_info(${q(tableName)})`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function column(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || "";
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function toPaise(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount > 100000 ? amount : amount * 100);
}

function slot(input = {}) {
  const date = input.signalDate ? new Date(`${String(input.signalDate).slice(0, 10)}T00:00:00+05:30`) : new Date();
  const parts = happyHoursEngine.getISTComponents(date);
  return {
    signalDate: String(input.signalDate || parts.nowDate).slice(0, 10),
    dayOfWeek: String(input.dayOfWeek || parts.nowDay).slice(0, 3).toLowerCase(),
    hourSlot: Math.max(0, Math.min(23, Number.parseInt(input.hourSlot ?? parts.nowTime.slice(0, 2), 10) || 0))
  };
}

function serviceCatalogStats(scope = {}) {
  const columns = safeColumns("services");
  if (!columns.length) {
    return { addOnCount: 0, serviceCount: 0, avgPricePaise: 0 };
  }
  const categoryCol = column(columns, ["category", "serviceCategory"]);
  const statusCol = column(columns, ["status"]);
  const priceCol = column(columns, ["price", "pricePaise", "amountPaise"]);
  const addOnsCol = column(columns, ["addOns", "addOnsJson", "addons"]);
  const idCol = column(columns, ["id", "serviceId"]);
  const categoryWhere = categoryCol && scope.serviceCategory !== "default"
    ? `AND LOWER(CAST(${q(categoryCol)} AS TEXT)) = @serviceCategory`
    : "";
  const serviceWhere = idCol && scope.primaryServiceId
    ? `AND CAST(${q(idCol)} AS TEXT) = @primaryServiceId`
    : "";
  const statusWhere = statusCol ? `AND LOWER(COALESCE(CAST(${q(statusCol)} AS TEXT), 'active')) = 'active'` : "";

  try {
    const rows = db.prepare(`
      SELECT ${priceCol ? q(priceCol) : "0"} AS price,
             ${addOnsCol ? q(addOnsCol) : "''"} AS addOns
      FROM services
      WHERE 1 = 1
        ${categoryWhere}
        ${serviceWhere}
        ${statusWhere}
      LIMIT 200
    `).all(scope);
    const prices = rows.map((row) => toPaise(row.price)).filter(Boolean);
    const addOnCount = rows.reduce((total, row) => {
      const addOns = parseJson(row.addOns, []);
      return total + (Array.isArray(addOns) ? addOns.length : 0);
    }, 0);
    const avgPricePaise = prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : 0;
    return { addOnCount, serviceCount: rows.length, avgPricePaise };
  } catch {
    return { addOnCount: 0, serviceCount: 0, avgPricePaise: 0 };
  }
}

function packageCatalogStats(scope = {}) {
  const columns = safeColumns("packages");
  if (!columns.length) {
    return { packageCount: 0, avgPackagePricePaise: 0 };
  }
  const tenantCol = column(columns, ["tenantId", "tenant_id"]);
  const branchCol = column(columns, ["branchId", "branch_id"]);
  const statusCol = column(columns, ["status"]);
  const priceCol = column(columns, ["price", "pricePaise", "packagePricePaise"]);
  const serviceIdsCol = column(columns, ["serviceIds", "serviceIdsJson", "services"]);
  if (!tenantCol) return { packageCount: 0, avgPackagePricePaise: 0 };

  const branchWhere = branchCol ? `AND (${q(branchCol)} = @branchId OR COALESCE(${q(branchCol)}, '') = '')` : "";
  const statusWhere = statusCol ? `AND LOWER(COALESCE(CAST(${q(statusCol)} AS TEXT), 'active')) = 'active'` : "";

  try {
    const rows = db.prepare(`
      SELECT ${priceCol ? q(priceCol) : "0"} AS price,
             ${serviceIdsCol ? q(serviceIdsCol) : "'[]'"} AS serviceIds
      FROM packages
      WHERE ${q(tenantCol)} = @tenantId
        ${branchWhere}
        ${statusWhere}
      LIMIT 200
    `).all(scope).filter((row) => {
      if (!scope.primaryServiceId) return true;
      const ids = parseJson(row.serviceIds, []);
      return Array.isArray(ids) ? ids.map(String).includes(scope.primaryServiceId) : true;
    });
    const prices = rows.map((row) => toPaise(row.price)).filter(Boolean);
    const avgPackagePricePaise = prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : 0;
    return { packageCount: rows.length, avgPackagePricePaise };
  } catch {
    return { packageCount: 0, avgPackagePricePaise: 0 };
  }
}

function bundleProfile(input = {}, catalog = {}, packages = {}) {
  const selectedServiceCount = Math.max(1, Number.parseInt(input.selectedServiceCount, 10) || 1);
  const addOnAttachRatePercent = percent(input.addOnAttachRatePercent, 0);
  const packageEligible = boolInt(input.packageEligible);
  if ((packageEligible || packages.packageCount > 0) && selectedServiceCount <= 2) {
    return {
      opportunity: "package_upgrade",
      marginPosture: "bundle_lift",
      cap: 26,
      points: 9,
      angle: "upgrade_to_package",
      reason: "Package opportunity available hai; discount ko package upgrade ke saath tie karo."
    };
  }
  if (catalog.addOnCount > 0 && selectedServiceCount === 1) {
    return {
      opportunity: "addon_cross_sell",
      marginPosture: "ticket_lift",
      cap: 22,
      points: addOnAttachRatePercent < 25 ? 8 : 5,
      angle: "attach_addon_offer",
      reason: "Single-service cart me add-on attach karke ticket size badh sakta hai."
    };
  }
  if (selectedServiceCount >= 3) {
    return {
      opportunity: "already_bundled",
      marginPosture: "protect_margin",
      cap: 10,
      points: -4,
      angle: "protect_high_ticket_margin",
      reason: "Cart already bundled/high-ticket hai; extra discount conservative rakho."
    };
  }
  return {
    opportunity: "collect_bundle_data",
    marginPosture: "standard",
    cap: 14,
    points: 2,
    angle: "small_bundle_nudge",
    reason: "Bundle/add-on signal limited hai; small nudge enough hai."
  };
}

function buildSuggestion(input = {}, mode = "recommended") {
  const current = normalizeScope(input);
  const currentSlot = slot(input);
  const serviceCategory = cleanCategory(input.serviceCategory);
  const primaryServiceId = String(input.primaryServiceId || "").trim();
  const selectedServiceCount = Math.max(1, Math.min(20, Number.parseInt(input.selectedServiceCount, 10) || 1));
  const cartTotalPaise = intPaise(input.cartTotalPaise || input.servicePricePaise);
  const baseDiscountPercent = percent(input.baseDiscountPercent, 5);
  const addOnAttachRatePercent = percent(input.addOnAttachRatePercent, 0);
  const bundleMarginPercent = percent(input.bundleMarginPercent, 45);
  const packageEligible = boolInt(input.packageEligible);
  const packagePricePaise = intPaise(input.packagePricePaise);
  const targetTicketLiftPaise = intPaise(input.targetTicketLiftPaise);
  const scope = { ...current, serviceCategory, primaryServiceId };
  const catalog = serviceCatalogStats(scope);
  const packages = packageCatalogStats(scope);
  const profile = bundleProfile({ selectedServiceCount, addOnAttachRatePercent, packageEligible }, catalog, packages);
  const reasons = [profile.reason];
  let points = profile.points;
  let cap = profile.cap;
  let marginPosture = profile.marginPosture;

  if (bundleMarginPercent >= 55) {
    points += 5;
    cap = Math.min(32, cap + 5);
    marginPosture = "high_margin_bundle";
    reasons.push("Bundle margin strong hai; discount ke baad bhi profit cushion available hai.");
  } else if (bundleMarginPercent < 30) {
    points -= 7;
    cap = Math.min(cap, 8);
    marginPosture = "low_margin_bundle";
    reasons.push("Bundle margin low hai; discount cap tight rakho.");
  } else {
    reasons.push("Bundle margin normal range me hai.");
  }

  if (targetTicketLiftPaise > 0) {
    points += Math.min(5, Math.round((targetTicketLiftPaise / Math.max(cartTotalPaise, 1)) * 20));
    reasons.push("Offer expected ticket lift ke saath tied hai.");
  } else if (!catalog.addOnCount && !packages.packageCount && !packageEligible) {
    points -= 4;
    reasons.push("Catalog package/add-on data missing hai; review-only suggestion rakho.");
  }

  if (mode === "conservative") points -= 4;
  if (mode === "aggressive") points += 5;

  const suggestedDiscountPercent = Math.round(Math.max(0, Math.min(cap, baseDiscountPercent + points)));
  const expectedDiscountPaise = Math.round(cartTotalPaise * (suggestedDiscountPercent / 100));
  const fallbackLift = packagePricePaise > cartTotalPaise ? packagePricePaise - cartTotalPaise : Math.round((catalog.avgPricePaise || cartTotalPaise) * 0.2);
  const expectedLiftPaise = targetTicketLiftPaise || Math.max(0, fallbackLift);
  const suggestedBundlePricePaise = packagePricePaise || Math.max(0, cartTotalPaise + expectedLiftPaise - expectedDiscountPaise);
  const expectedNetRevenuePaise = Math.max(0, cartTotalPaise + expectedLiftPaise - expectedDiscountPaise);

  return {
    ...current,
    ...currentSlot,
    serviceCategory,
    primaryServiceId,
    selectedServiceCount,
    cartTotalPaise,
    baseDiscountPercent,
    bundleMarginPercent,
    addOnAttachRatePercent,
    targetTicketLiftPaise,
    packageEligible,
    packagePricePaise,
    candidateAddOnCount: catalog.addOnCount,
    candidatePackageCount: packages.packageCount,
    avgCatalogPricePaise: catalog.avgPricePaise,
    bundleOpportunity: profile.opportunity,
    marginPosture,
    campaignAngle: profile.angle,
    suggestedDiscountPercent,
    expectedDiscountPaise,
    suggestedBundlePricePaise,
    expectedNetRevenuePaise,
    status: catalog.addOnCount || packages.packageCount || packageEligible || targetTicketLiftPaise ? "ready" : "collecting",
    mode,
    reasons
  };
}

export function evaluate(scope = {}) {
  const best = buildSuggestion(scope, "recommended");
  const rows = [
    buildSuggestion(scope, "conservative"),
    best,
    buildSuggestion(scope, "aggressive")
  ];
  return {
    status: best.status,
    best,
    rows,
    summary: {
      bundleOpportunity: best.bundleOpportunity,
      marginPosture: best.marginPosture,
      candidateAddOnCount: best.candidateAddOnCount,
      candidatePackageCount: best.candidatePackageCount,
      maxDiscountPercent: Math.max(...rows.map((row) => Number(row.suggestedDiscountPercent || 0))),
      expectedNetRevenuePaise: best.expectedNetRevenuePaise
    }
  };
}

export function saveSuggestion(scope = {}) {
  const row = evaluate(scope).best;
  const payload = {
    ...row,
    reasons: JSON.stringify(row.reasons || []),
    status: "suggested"
  };
  const result = db.prepare(`
    INSERT INTO happyHoursBundleAwareSuggestions (
      tenantId, branchId, serviceCategory, primaryServiceId, signalDate,
      dayOfWeek, hourSlot, selectedServiceCount, cartTotalPaise,
      baseDiscountPercent, bundleMarginPercent, addOnAttachRatePercent,
      targetTicketLiftPaise, packageEligible, packagePricePaise,
      candidateAddOnCount, candidatePackageCount, avgCatalogPricePaise,
      bundleOpportunity, marginPosture, campaignAngle,
      suggestedDiscountPercent, expectedDiscountPaise, suggestedBundlePricePaise,
      expectedNetRevenuePaise, status, reasons
    )
    VALUES (
      @tenantId, @branchId, @serviceCategory, @primaryServiceId, @signalDate,
      @dayOfWeek, @hourSlot, @selectedServiceCount, @cartTotalPaise,
      @baseDiscountPercent, @bundleMarginPercent, @addOnAttachRatePercent,
      @targetTicketLiftPaise, @packageEligible, @packagePricePaise,
      @candidateAddOnCount, @candidatePackageCount, @avgCatalogPricePaise,
      @bundleOpportunity, @marginPosture, @campaignAngle,
      @suggestedDiscountPercent, @expectedDiscountPaise, @suggestedBundlePricePaise,
      @expectedNetRevenuePaise, @status, @reasons
    )
  `).run(payload);
  return getSuggestion({ ...row, id: Number(result.lastInsertRowid) });
}

export function listSuggestions(scope = {}) {
  const current = normalizeScope(scope);
  const status = String(scope.status || "").trim();
  const limit = Math.min(100, Math.max(1, Number.parseInt(scope.limit, 10) || 25));
  return {
    rows: db.prepare(`
      SELECT *
      FROM happyHoursBundleAwareSuggestions
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND (@status = '' OR status = @status)
      ORDER BY createdAt DESC, id DESC
      LIMIT @limit
    `).all({ ...current, status, limit }).map(parseSuggestion)
  };
}

export function updateStatus(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const status = String(scope.status || "suggested").trim();
  db.prepare(`
    UPDATE happyHoursBundleAwareSuggestions
    SET status = @status
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).run({ ...current, id, status });
  return getSuggestion({ ...current, id });
}

function getSuggestion(scope = {}) {
  const current = normalizeScope(scope);
  const id = Number.parseInt(scope.id, 10) || 0;
  const row = db.prepare(`
    SELECT *
    FROM happyHoursBundleAwareSuggestions
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).get({ ...current, id });
  return parseSuggestion(row);
}

function parseSuggestion(row) {
  if (!row) return null;
  return {
    ...row,
    packageEligible: Boolean(row.packageEligible),
    reasons: JSON.parse(row.reasons || "[]")
  };
}

export const happyHoursBundleAwareRepo = {
  evaluate,
  saveSuggestion,
  listSuggestions,
  updateStatus
};
