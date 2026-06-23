import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS happyHoursInventoryAwareSuggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    productId TEXT NOT NULL DEFAULT '',
    productName TEXT NOT NULL DEFAULT '',
    serviceCategory TEXT NOT NULL DEFAULT 'default',
    signalDate TEXT NOT NULL,
    sourceTable TEXT NOT NULL DEFAULT '',
    sourceRecordId TEXT NOT NULL DEFAULT '',
    stockQty REAL NOT NULL DEFAULT 0,
    lowStockThreshold REAL NOT NULL DEFAULT 0,
    highStockThreshold REAL NOT NULL DEFAULT 0,
    expiryDate TEXT NOT NULL DEFAULT '',
    daysToExpiry INTEGER NOT NULL DEFAULT 9999,
    stockRisk TEXT NOT NULL DEFAULT 'unknown',
    expiryRisk TEXT NOT NULL DEFAULT 'unknown',
    bundleAction TEXT NOT NULL DEFAULT 'collect_inventory',
    suggestedDiscountPercent INTEGER NOT NULL DEFAULT 0,
    productPricePaise INTEGER NOT NULL DEFAULT 0,
    servicePricePaise INTEGER NOT NULL DEFAULT 0,
    expectedDiscountPaise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'suggested',
    reasons TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_inventoryAwareSuggestions_scope
    ON happyHoursInventoryAwareSuggestions(tenantId, branchId, status, createdAt);
`);

const PRODUCT_TABLES = [
  "inventory_batches",
  "inventoryItems",
  "products",
  "inventory",
  "productMasters",
  "inventory_products"
];

function normalizeScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
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

function q(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe identifier");
  return `"${identifier}"`;
}

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function paise(value) {
  return Math.max(0, Math.round(n(value, 0)));
}

function textExpr(columnName, fallback = "''") {
  return columnName ? `COALESCE(CAST(${q(columnName)} AS TEXT), '')` : fallback;
}

function numExpr(columnName) {
  return columnName ? `COALESCE(${q(columnName)}, 0)` : "0";
}

function currentSignalDate(input = {}) {
  if (input.signalDate) return String(input.signalDate).slice(0, 10);
  return happyHoursEngine.getISTComponents(new Date()).nowDate;
}

function daysUntil(dateValue, signalDate) {
  const date = String(dateValue || "").slice(0, 10);
  if (!date) return 9999;
  const expiryMs = Date.parse(`${date}T00:00:00+05:30`);
  const signalMs = Date.parse(`${signalDate}T00:00:00+05:30`);
  if (!Number.isFinite(expiryMs) || !Number.isFinite(signalMs)) return 9999;
  return Math.ceil((expiryMs - signalMs) / 86400000);
}

function sourceRows(scope = {}) {
  const current = normalizeScope(scope);
  const requestedProductId = String(scope.productId || "").trim();
  const requestedCategory = String(scope.serviceCategory || "").trim();
  const rows = [];

  for (const tableName of PRODUCT_TABLES) {
    const columns = safeColumns(tableName);
    if (!columns.length) continue;

    const tenantCol = column(columns, ["tenantId", "tenant_id"]);
    const branchCol = column(columns, ["branchId", "branch_id"]);
    const productCol = column(columns, ["productId", "id", "sku", "product_id", "itemId"]);
    const nameCol = column(columns, ["productName", "name", "itemName", "displayName"]);
    const categoryCol = column(columns, ["serviceCategory", "category", "productCategory"]);
    const stockCol = column(columns, ["quantityAvailable", "stock", "stockQty", "currentStock", "onHandQty", "availableQty", "quantity", "qty"]);
    const lowCol = column(columns, ["lowStockThreshold", "reorderLevel", "minStock", "minimumStock"]);
    const highCol = column(columns, ["highStockThreshold", "maxStock", "targetStock", "idealStock"]);
    const expiryCol = column(columns, ["expiryDate", "expiresAt", "batchExpiry", "expiry"]);
    const priceCol = column(columns, ["pricePaise", "sellingPricePaise", "mrpPaise", "retailPricePaise", "price", "mrp"]);

    if (!tenantCol || !branchCol || !productCol) continue;

    const productWhere = requestedProductId ? `AND CAST(${q(productCol)} AS TEXT) = @productId` : "";
    const categoryWhere = requestedCategory && requestedCategory !== "default" && categoryCol
      ? `AND LOWER(CAST(${q(categoryCol)} AS TEXT)) = LOWER(@serviceCategory)`
      : "";

    try {
      const tableRows = db.prepare(`
        SELECT
          CAST(${q(productCol)} AS TEXT) AS productId,
          ${textExpr(nameCol, `CAST(${q(productCol)} AS TEXT)`)} AS productName,
          ${textExpr(categoryCol, "'default'")} AS serviceCategory,
          ${numExpr(stockCol)} AS stockQty,
          ${numExpr(lowCol)} AS lowStockThreshold,
          ${numExpr(highCol)} AS highStockThreshold,
          ${textExpr(expiryCol)} AS expiryDate,
          ${numExpr(priceCol)} AS productPricePaise,
          ${textExpr(productCol)} AS sourceRecordId,
          '${tableName}' AS sourceTable
        FROM ${q(tableName)}
        WHERE ${q(tenantCol)} = @tenantId
          AND ${q(branchCol)} = @branchId
          ${productWhere}
          ${categoryWhere}
        ORDER BY ${expiryCol ? `CASE WHEN ${q(expiryCol)} = '' THEN 1 ELSE 0 END, ${q(expiryCol)} ASC,` : ""} productName ASC
        LIMIT @limit
      `).all({
        ...current,
        productId: requestedProductId,
        serviceCategory: requestedCategory,
        limit: Math.min(75, Math.max(1, Number.parseInt(scope.limit, 10) || 25))
      });
      rows.push(...tableRows);
    } catch {
      continue;
    }
  }

  if (rows.length) return rows;
  if (requestedProductId) {
    return [{
      productId: requestedProductId,
      productName: requestedProductId,
      serviceCategory: requestedCategory || "default",
      stockQty: 0,
      lowStockThreshold: 0,
      highStockThreshold: 0,
      expiryDate: "",
      productPricePaise: paise(scope.productPricePaise),
      sourceRecordId: requestedProductId,
      sourceTable: "manual_input"
    }];
  }
  return [];
}

function suggestionForProduct(input = {}, row = {}) {
  const current = normalizeScope(input);
  const signalDate = currentSignalDate(input);
  const servicePricePaise = paise(input.servicePricePaise || 0);
  const productPricePaise = paise(input.productPricePaise || row.productPricePaise || 0);
  const stockQty = n(row.stockQty, 0);
  const lowStockThreshold = n(row.lowStockThreshold, n(input.lowStockThreshold, 3));
  const highStockThreshold = n(row.highStockThreshold, n(input.overstockThreshold, 20));
  const expiryWindowDays = Math.max(1, Number.parseInt(input.expiryWindowDays, 10) || 30);
  const daysToExpiry = daysUntil(row.expiryDate, signalDate);
  const reasons = [];
  let suggestedDiscountPercent = 0;
  let bundleAction = "collect_inventory";
  let stockRisk = "unknown";
  let expiryRisk = "unknown";

  if (!row.sourceTable) {
    reasons.push("Inventory source data abhi missing hai; discount safely disabled.");
  } else if (stockQty <= 0) {
    stockRisk = "out_of_stock";
    bundleAction = "avoid_out_of_stock";
    reasons.push("Stock available nahi hai, isliye offer/bundle avoid karo.");
  } else if (daysToExpiry < 0) {
    stockRisk = "blocked";
    expiryRisk = "expired";
    bundleAction = "block_expired_stock";
    reasons.push("Product expiry cross kar chuka hai; customer offer me include mat karo.");
  } else if (stockQty <= lowStockThreshold) {
    stockRisk = "low_stock";
    expiryRisk = daysToExpiry <= expiryWindowDays ? "expiring" : "safe";
    bundleAction = "avoid_low_stock";
    reasons.push("Stock low hai; discount demand aur stockout risk badha sakta hai.");
  } else if (daysToExpiry <= 7) {
    stockRisk = "sell_through_needed";
    expiryRisk = "urgent_expiry";
    bundleAction = "expiry_bundle";
    suggestedDiscountPercent = 20;
    reasons.push("Expiry 7 din ke andar hai; controlled bundle discount useful hai.");
  } else if (daysToExpiry <= expiryWindowDays) {
    stockRisk = "sell_through_needed";
    expiryRisk = "expiring";
    bundleAction = "expiry_nudge";
    suggestedDiscountPercent = 15;
    reasons.push("Expiry window me stock hai; service ke saath product nudge suggest hua.");
  } else if (stockQty >= highStockThreshold) {
    stockRisk = "overstock";
    expiryRisk = "safe";
    bundleAction = "overstock_bundle";
    suggestedDiscountPercent = 12;
    reasons.push("Stock high hai; bundle offer se inventory velocity improve ho sakti hai.");
  } else {
    stockRisk = "healthy";
    expiryRisk = daysToExpiry === 9999 ? "unknown" : "safe";
    bundleAction = "small_bundle";
    suggestedDiscountPercent = 5;
    reasons.push("Stock healthy hai; small bundle nudge enough hai.");
  }

  const discountBasePaise = servicePricePaise + productPricePaise;
  return {
    ...current,
    productId: String(row.productId || input.productId || ""),
    productName: String(row.productName || row.productId || input.productId || "Inventory signal"),
    serviceCategory: String(input.serviceCategory || row.serviceCategory || "default").trim() || "default",
    signalDate,
    sourceTable: String(row.sourceTable || ""),
    sourceRecordId: String(row.sourceRecordId || row.productId || ""),
    stockQty,
    lowStockThreshold,
    highStockThreshold,
    expiryDate: String(row.expiryDate || ""),
    daysToExpiry,
    stockRisk,
    expiryRisk,
    bundleAction,
    suggestedDiscountPercent,
    productPricePaise,
    servicePricePaise,
    expectedDiscountPaise: Math.round(discountBasePaise * (suggestedDiscountPercent / 100)),
    status: row.sourceTable && row.sourceTable !== "manual_input" ? "ready" : "collecting",
    reasons
  };
}

export function evaluate(scope = {}) {
  const rows = sourceRows(scope).map((row) => suggestionForProduct(scope, row));
  const best = [...rows].sort((a, b) =>
    b.suggestedDiscountPercent - a.suggestedDiscountPercent ||
    a.daysToExpiry - b.daysToExpiry ||
    b.stockQty - a.stockQty
  )[0] || null;

  return {
    status: rows.some((row) => row.status === "ready") ? "ready" : "collecting",
    best,
    rows,
    summary: {
      productCount: rows.length,
      expiringCount: rows.filter((row) => ["urgent_expiry", "expiring"].includes(row.expiryRisk)).length,
      overstockCount: rows.filter((row) => row.stockRisk === "overstock").length,
      blockedCount: rows.filter((row) => row.suggestedDiscountPercent === 0).length,
      totalExpectedDiscountPaise: rows.reduce((sum, row) => sum + Number(row.expectedDiscountPaise || 0), 0)
    }
  };
}

export function saveSuggestion(scope = {}) {
  const evaluation = evaluate(scope);
  const row = evaluation.best;
  if (!row) throw new Error("No inventory-aware suggestion available");
  const payload = {
    ...row,
    reasons: JSON.stringify(row.reasons || []),
    status: "suggested"
  };
  const result = db.prepare(`
    INSERT INTO happyHoursInventoryAwareSuggestions (
      tenantId, branchId, productId, productName, serviceCategory, signalDate,
      sourceTable, sourceRecordId, stockQty, lowStockThreshold, highStockThreshold,
      expiryDate, daysToExpiry, stockRisk, expiryRisk, bundleAction,
      suggestedDiscountPercent, productPricePaise, servicePricePaise,
      expectedDiscountPaise, status, reasons
    )
    VALUES (
      @tenantId, @branchId, @productId, @productName, @serviceCategory, @signalDate,
      @sourceTable, @sourceRecordId, @stockQty, @lowStockThreshold, @highStockThreshold,
      @expiryDate, @daysToExpiry, @stockRisk, @expiryRisk, @bundleAction,
      @suggestedDiscountPercent, @productPricePaise, @servicePricePaise,
      @expectedDiscountPaise, @status, @reasons
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
      FROM happyHoursInventoryAwareSuggestions
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
    UPDATE happyHoursInventoryAwareSuggestions
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
    FROM happyHoursInventoryAwareSuggestions
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `).get({ ...current, id });
  return parseSuggestion(row);
}

function parseSuggestion(row) {
  if (!row) return null;
  return {
    ...row,
    reasons: JSON.parse(row.reasons || "[]")
  };
}

export const happyHoursInventoryAwareRepo = {
  evaluate,
  saveSuggestion,
  listSuggestions,
  updateStatus
};
