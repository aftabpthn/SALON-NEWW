import { db } from "../db.js";
import { conflict, notFound } from "../utils/app-error.js";
import { assertBranch, camel, makeId, now, number, toJson } from "./enterprise-command-utils.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const UNIT_ALIASES = new Map([
  ["gm", "g"],
  ["gram", "g"],
  ["grams", "g"],
  ["ltr", "l"],
  ["liter", "l"],
  ["litre", "l"],
  ["liters", "l"],
  ["litres", "l"],
  ["piece", "pcs"],
  ["pieces", "pcs"],
  ["nos", "pcs"],
  ["no", "pcs"]
]);
const LOW_BALANCE_PCT = 20;
const MEASURE_UNITS = new Set(["ml", "g", "kg", "l"]);

let schemaReady = false;

function ensureBackbarSchema() {
  if (schemaReady) return;
  ensureProductUnitColumns();
  db.exec(`
    CREATE TABLE IF NOT EXISTS backbar_product_containers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT '',
      productId TEXT NOT NULL,
      productName TEXT NOT NULL DEFAULT '',
      containerNo INTEGER NOT NULL DEFAULT 1,
      stockUnit TEXT NOT NULL DEFAULT 'pcs',
      measureUnit TEXT NOT NULL DEFAULT 'ml',
      capacityQty REAL NOT NULL DEFAULT 0,
      usedQty REAL NOT NULL DEFAULT 0,
      balanceQty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      openedFromDraftId TEXT NOT NULL DEFAULT '',
      openedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finishedAt TEXT NOT NULL DEFAULT '',
      stockTransactionId TEXT NOT NULL DEFAULT '',
      createdBy TEXT NOT NULL DEFAULT '',
      updatedBy TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, branch_id, productId, containerNo)
    );
    CREATE INDEX IF NOT EXISTS idx_backbar_containers_product ON backbar_product_containers(tenant_id, branch_id, productId, status, containerNo);

    CREATE TABLE IF NOT EXISTS backbar_product_usage_entries (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT '',
      containerId TEXT NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL DEFAULT '',
      draftId TEXT NOT NULL DEFAULT '',
      invoiceId TEXT NOT NULL DEFAULT '',
      invoiceNumber TEXT NOT NULL DEFAULT '',
      serviceId TEXT NOT NULL DEFAULT '',
      serviceName TEXT NOT NULL DEFAULT '',
      clientId TEXT NOT NULL DEFAULT '',
      clientName TEXT NOT NULL DEFAULT '',
      staffId TEXT NOT NULL DEFAULT '',
      staffName TEXT NOT NULL DEFAULT '',
      usedQty REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'ml',
      productCost REAL NOT NULL DEFAULT 0,
      usageType TEXT NOT NULL DEFAULT 'client',
      reason TEXT NOT NULL DEFAULT '',
      balanceAfter REAL NOT NULL DEFAULT 0,
      createdBy TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_backbar_usage_draft ON backbar_product_usage_entries(tenant_id, branch_id, draftId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_backbar_usage_product ON backbar_product_usage_entries(tenant_id, branch_id, productId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_backbar_usage_container ON backbar_product_usage_entries(tenant_id, containerId, createdAt);

    CREATE TABLE IF NOT EXISTS backbar_product_alerts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT '',
      productId TEXT NOT NULL DEFAULT '',
      containerId TEXT NOT NULL DEFAULT '',
      draftId TEXT NOT NULL DEFAULT '',
      invoiceId TEXT NOT NULL DEFAULT '',
      alertType TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      evidenceJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_backbar_alerts_scope ON backbar_product_alerts(tenant_id, branch_id, status, createdAt);
    CREATE INDEX IF NOT EXISTS idx_backbar_alerts_product ON backbar_product_alerts(tenant_id, branch_id, productId, createdAt);

    CREATE TABLE IF NOT EXISTS backbar_override_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT '',
      productId TEXT NOT NULL,
      productName TEXT NOT NULL DEFAULT '',
      activeContainerId TEXT NOT NULL DEFAULT '',
      activeContainerNo INTEGER NOT NULL DEFAULT 0,
      activeBalanceQty REAL NOT NULL DEFAULT 0,
      stockUnit TEXT NOT NULL DEFAULT 'pcs',
      measureUnit TEXT NOT NULL DEFAULT 'ml',
      capacityQty REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      requestedBy TEXT NOT NULL DEFAULT '',
      approvedBy TEXT NOT NULL DEFAULT '',
      approvedAt TEXT NOT NULL DEFAULT '',
      rejectedBy TEXT NOT NULL DEFAULT '',
      rejectedAt TEXT NOT NULL DEFAULT '',
      decisionNote TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_backbar_override_requests_scope ON backbar_override_requests(tenant_id, branch_id, status, createdAt);
  `);
  schemaReady = true;
}

function ensureProductUnitColumns() {
  const columns = db.prepare("PRAGMA table_info(products)").all().map((column) => column.name);
  if (!columns.includes("unit")) db.prepare("ALTER TABLE products ADD COLUMN unit TEXT DEFAULT 'pcs'").run();
  if (!columns.includes("packSize")) db.prepare("ALTER TABLE products ADD COLUMN packSize REAL DEFAULT 1").run();
  if (!columns.includes("packUnit")) db.prepare("ALTER TABLE products ADD COLUMN packUnit TEXT DEFAULT 'pcs'").run();
}

function normalizeUnit(unit = "") {
  const clean = String(unit || "").trim().toLowerCase();
  return UNIT_ALIASES.get(clean) || clean || "pcs";
}

function sameUnit(left = "", right = "") {
  return normalizeUnit(left) === normalizeUnit(right);
}

function compatibleMeasureUnit(left = "", right = "") {
  const from = normalizeUnit(left);
  const to = normalizeUnit(right);
  if (from === to) return true;
  return (from === "kg" && to === "g") || (from === "g" && to === "kg") || (from === "l" && to === "ml") || (from === "ml" && to === "l");
}

function convertMeasureQty(quantity, fromUnit, toUnit) {
  const qty = number(quantity, 0);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return money(qty);
  if (from === "kg" && to === "g") return money(qty * 1000);
  if (from === "g" && to === "kg") return money(qty / 1000);
  if (from === "l" && to === "ml") return money(qty * 1000);
  if (from === "ml" && to === "l") return money(qty / 1000);
  return money(qty);
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function parseLineItems(row = {}) {
  try {
    return JSON.parse(row.line_items_json || row.lineItemsJson || "[]");
  } catch {
    return [];
  }
}

function loadDraft(id, access) {
  const draft = db.prepare("SELECT * FROM product_consume_drafts WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
  if (!draft) throw notFound("Product consume draft not found");
  if (draft.branch_id) assertBranch(access, draft.branch_id);
  return draft;
}

function loadProduct(productId, access, branchId = "") {
  const product = db.prepare("SELECT * FROM products WHERE id = ? AND tenantId = ?").get(productId, access.tenantId);
  if (!product) throw notFound("Product not found");
  if (product.branchId) assertBranch(access, product.branchId);
  if (branchId && product.branchId && product.branchId !== branchId) throw conflict("Product does not belong to selected branch");
  return product;
}

function productUnits(product = {}, line = {}) {
  const stockUnit = normalizeUnit(line.stockUnit || line.stock_unit || product.unit || product.stockUnit || product.stock_unit || "pcs");
  const measureUnit = normalizeUnit(line.packUnit || line.pack_unit || product.packUnit || product.pack_unit || product.unit || "ml");
  const capacityQty = money(number(line.packSize ?? line.pack_size ?? product.packSize ?? product.pack_size, 0));
  return { stockUnit, measureUnit, capacityQty };
}

function isBackbarLine(product = {}, line = {}) {
  const { stockUnit, measureUnit, capacityQty } = productUnits(product, line);
  const requestedUnit = normalizeUnit(line.unit || measureUnit);
  return capacityQty > 0 && MEASURE_UNITS.has(measureUnit) && !sameUnit(stockUnit, measureUnit) && compatibleMeasureUnit(requestedUnit, measureUnit);
}

function stockUnitCost(product = {}, line = {}) {
  return money(number(line.stockUnitCost ?? line.stock_unit_cost ?? product.unitCost ?? product.unit_cost, 0));
}

function measureUnitCost(product = {}, line = {}) {
  const { capacityQty } = productUnits(product, line);
  const cost = stockUnitCost(product, line);
  return capacityQty > 0 ? money(cost / capacityQty) : money(number(line.unitCost ?? line.unit_cost, 0));
}

function mapContainer(row = {}) {
  const mapped = camel(row);
  const containerNo = Number(mapped.containerNo || 0);
  const stockUnit = mapped.stockUnit || "pcs";
  return {
    ...mapped,
    containerNo,
    containerCode: `${stockUnit} #${containerNo || 1}`,
    capacityQty: money(mapped.capacityQty),
    usedQty: money(mapped.usedQty),
    usedQuantity: money(mapped.usedQty),
    balanceQty: money(mapped.balanceQty),
    balanceQuantity: money(mapped.balanceQty)
  };
}

function mapUsage(row = {}) {
  const mapped = camel(row);
  return {
    ...mapped,
    usedQty: money(mapped.usedQty),
    usedQuantity: money(mapped.usedQty),
    productCost: money(mapped.productCost),
    cost: money(mapped.productCost),
    balanceAfter: money(mapped.balanceAfter),
    usedAt: mapped.createdAt || ""
  };
}

function mapAlert(row = {}) {
  return camel(row);
}

function mapOverrideRequest(row = {}) {
  const mapped = camel(row);
  return {
    ...mapped,
    activeContainerNo: Number(mapped.activeContainerNo || 0),
    activeBalanceQty: money(mapped.activeBalanceQty),
    capacityQty: money(mapped.capacityQty)
  };
}

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function usageText(entries = []) {
  const qtyByUnit = {};
  for (const entry of entries) {
    const unit = entry.unit || "pcs";
    qtyByUnit[unit] = money(number(qtyByUnit[unit], 0) + number(entry.usedQty, 0));
  }
  const parts = Object.entries(qtyByUnit).map(([unit, qty]) => `${qty} ${unit}`);
  return parts.length ? parts.join(" + ") : "0";
}

function groupUsageRows(entries = [], keyFn, baseFn = () => ({})) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyFn(entry);
    const row = groups.get(key) || {
      ...baseFn(entry),
      entries: 0,
      quantityByUnit: {},
      totalUsedText: "0",
      cost: 0,
      exceptionCount: 0,
      lastUsedAt: ""
    };
    const unit = entry.unit || "pcs";
    row.entries += 1;
    row.quantityByUnit[unit] = money(number(row.quantityByUnit[unit], 0) + number(entry.usedQty, 0));
    row.cost = money(number(row.cost, 0) + number(entry.productCost, 0));
    if (entry.usageType !== "client") row.exceptionCount += 1;
    row.lastUsedAt = String(entry.createdAt || "").localeCompare(String(row.lastUsedAt || "")) > 0 ? entry.createdAt : row.lastUsedAt;
    row.totalUsedText = Object.entries(row.quantityByUnit).map(([unitName, qty]) => `${qty} ${unitName}`).join(" + ");
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0) || String(b.lastUsedAt || "").localeCompare(String(a.lastUsedAt || "")));
}

function daysOpen(dateText = "") {
  const opened = new Date(dateText || 0).getTime();
  if (!opened) return 0;
  return Math.max(0, Math.floor((Date.now() - opened) / 86400000));
}

export class BackbarProductConsumptionService {
  constructor() {
    ensureBackbarSchema();
  }

  isBackbarLine(product = {}, line = {}) {
    return isBackbarLine(product, line);
  }

  applyDraftConsumption({ draft = {}, lines = [], access = {}, consumeStockUnit } = {}) {
    ensureBackbarSchema();
    const passthroughLines = [];
    const allocations = [];
    const alerts = [];
    const stockDeductions = [];

    for (const line of lines) {
      const productId = line.productId || line.product_id;
      if (!productId) continue;
      const product = loadProduct(productId, access, draft.branch_id || draft.branchId || "");
      if (!isBackbarLine(product, line)) {
        passthroughLines.push(line);
        continue;
      }
      const applied = this.applyBackbarLine({ draft, line, product, access, consumeStockUnit });
      allocations.push(...applied.allocations);
      alerts.push(...applied.alerts);
      stockDeductions.push(...applied.stockDeductions);
    }

    return { passthroughLines, allocations, alerts, stockDeductions };
  }

  applyBackbarLine({ draft = {}, line = {}, product = {}, access = {}, consumeStockUnit } = {}) {
    const { stockUnit, measureUnit, capacityQty } = productUnits(product, line);
    const requestedQty = convertMeasureQty(line.actualQty ?? line.actual_qty ?? line.quantity, line.unit || measureUnit, measureUnit);
    const unitCost = measureUnitCost(product, line);
    const maxQty = convertMeasureQty(line.maxQty ?? line.max_qty, line.unit || measureUnit, measureUnit);
    const allocations = [];
    const alerts = [];
    const stockDeductions = [];
    let remaining = requestedQty;

    if (maxQty > 0 && requestedQty > maxQty) {
      alerts.push(this.createAlert({
        access,
        branchId: draft.branch_id,
        productId: product.id,
        draftId: draft.id,
        invoiceId: draft.invoice_id,
        alertType: "recipe_overuse",
        severity: "high",
        title: `${product.name} usage above recipe range`,
        message: `Entered ${requestedQty} ${measureUnit}; max allowed is ${maxQty} ${measureUnit}.`,
        evidence: { requestedQty, maxQty, serviceName: draft.service_name || "" }
      }));
    }

    while (remaining > 0) {
      const container = this.activeOrOpenContainer({ access, branchId: draft.branch_id, product, stockUnit, measureUnit, capacityQty, draftId: draft.id });
      const take = Math.min(remaining, number(container.balanceQty, 0));
      const balanceAfter = money(number(container.balanceQty, 0) - take);
      const usedAfter = money(number(container.usedQty, 0) + take);
      const usage = this.insertUsage({
        access,
        draft,
        line,
        product,
        container,
        usedQty: take,
        unit: measureUnit,
        productCost: money(take * unitCost),
        balanceAfter
      });

      db.prepare(`
        UPDATE backbar_product_containers
        SET usedQty = ?, balanceQty = ?, updatedBy = ?, updatedAt = ?
        WHERE id = ? AND tenant_id = ?
      `).run(usedAfter, balanceAfter, access.userId || "", now(), container.id, access.tenantId);

      allocations.push({ containerId: container.id, containerNo: container.containerNo, productId: product.id, usedQty: take, unit: measureUnit, balanceAfter, usage });

      if (balanceAfter <= 0) {
        const deduction = consumeStockUnit({
          productId: product.id,
          branchId: draft.branch_id,
          quantity: 1,
          unit: stockUnit,
          type: "backbar-container-finished",
          reason: `${product.name} ${stockUnit} #${container.containerNo} fully consumed from product consume ledger`,
          referenceType: "product_consume_container",
          referenceId: container.id,
          unitCost: stockUnitCost(product, line)
        });
        const transactionId = deduction?.deductions?.[0]?.transaction?.id || "";
        db.prepare(`
          UPDATE backbar_product_containers
          SET status = 'finished', balanceQty = 0, finishedAt = ?, stockTransactionId = ?, updatedBy = ?, updatedAt = ?
          WHERE id = ? AND tenant_id = ?
        `).run(now(), transactionId, access.userId || "", now(), container.id, access.tenantId);
        stockDeductions.push(deduction);
        alerts.push(this.createAlert({
          access,
          branchId: draft.branch_id,
          productId: product.id,
          containerId: container.id,
          draftId: draft.id,
          invoiceId: draft.invoice_id,
          alertType: "container_finished",
          severity: "info",
          title: `${product.name} ${stockUnit} #${container.containerNo} finished`,
          message: `Full ${capacityQty} ${measureUnit} consumed; 1 ${stockUnit} deducted from stock.`,
          evidence: { containerNo: container.containerNo, capacityQty, measureUnit, stockUnit }
        }));
      } else if (capacityQty > 0 && (balanceAfter / capacityQty) * 100 <= LOW_BALANCE_PCT) {
        alerts.push(this.createAlert({
          access,
          branchId: draft.branch_id,
          productId: product.id,
          containerId: container.id,
          draftId: draft.id,
          invoiceId: draft.invoice_id,
          alertType: "low_balance",
          severity: "medium",
          title: `${product.name} ${stockUnit} #${container.containerNo} low balance`,
          message: `${balanceAfter} ${measureUnit} left before the next ${stockUnit} can open.`,
          evidence: { containerNo: container.containerNo, balanceAfter, capacityQty, measureUnit }
        }));
      }

      remaining = money(remaining - take);
    }

    return { allocations, alerts, stockDeductions };
  }

  activeOrOpenContainer({ access, branchId = "", product = {}, stockUnit = "pcs", measureUnit = "ml", capacityQty = 0, draftId = "" } = {}) {
    const active = db.prepare(`
      SELECT * FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId = ? AND status = 'open' AND balanceQty > 0
      ORDER BY containerNo ASC
      LIMIT 1
    `).get(access.tenantId, branchId, product.id);
    if (active) return mapContainer(active);

    const openCount = db.prepare(`
      SELECT COUNT(*) AS count FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId = ? AND status = 'open'
    `).get(access.tenantId, branchId, product.id).count;
    const sealedStock = number(product.stock, 0) - number(openCount, 0);
    if (sealedStock <= 0) throw conflict(`${product.name} has no sealed ${stockUnit} available to open`);

    const nextNo = number(db.prepare(`
      SELECT MAX(containerNo) AS maxNo FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId = ?
    `).get(access.tenantId, branchId, product.id).maxNo, 0) + 1;
    const id = makeId("bbpc");
    const createdAt = now();
    db.prepare(`
      INSERT INTO backbar_product_containers (
        id, tenant_id, branch_id, productId, productName, containerNo, stockUnit, measureUnit,
        capacityQty, usedQty, balanceQty, status, openedFromDraftId, openedAt, createdBy, updatedBy, createdAt, updatedAt
      ) VALUES (
        @id, @tenant_id, @branch_id, @productId, @productName, @containerNo, @stockUnit, @measureUnit,
        @capacityQty, 0, @capacityQty, 'open', @openedFromDraftId, @openedAt, @createdBy, @updatedBy, @createdAt, @updatedAt
      )
    `).run({
      id,
      tenant_id: access.tenantId,
      branch_id: branchId,
      productId: product.id,
      productName: product.name || product.id,
      containerNo: nextNo,
      stockUnit,
      measureUnit,
      capacityQty,
      openedFromDraftId: draftId,
      openedAt: createdAt,
      createdBy: access.userId || "",
      updatedBy: access.userId || "",
      createdAt,
      updatedAt: createdAt
    });
    const container = mapContainer(db.prepare("SELECT * FROM backbar_product_containers WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
    this.createAlert({
      access,
      branchId,
      productId: product.id,
      containerId: id,
      draftId,
      alertType: "container_opened",
      severity: "info",
      title: `${product.name} ${stockUnit} #${nextNo} opened`,
      message: `Opened for service consumption. ${capacityQty} ${measureUnit} available.`,
      evidence: { containerNo: nextNo, capacityQty, measureUnit, stockUnit }
    });
    return container;
  }

  insertUsage({ access = {}, draft = {}, line = {}, product = {}, container = {}, usedQty = 0, unit = "ml", productCost = 0, balanceAfter = 0 } = {}) {
    const id = makeId("bbuse");
    db.prepare(`
      INSERT INTO backbar_product_usage_entries (
        id, tenant_id, branch_id, containerId, productId, productName, draftId, invoiceId, invoiceNumber,
        serviceId, serviceName, clientId, clientName, staffId, staffName, usedQty, unit, productCost,
        usageType, reason, balanceAfter, createdBy, createdAt
      ) VALUES (
        @id, @tenant_id, @branch_id, @containerId, @productId, @productName, @draftId, @invoiceId, @invoiceNumber,
        @serviceId, @serviceName, @clientId, @clientName, @staffId, @staffName, @usedQty, @unit, @productCost,
        @usageType, @reason, @balanceAfter, @createdBy, @createdAt
      )
    `).run({
      id,
      tenant_id: access.tenantId,
      branch_id: draft.branch_id || "",
      containerId: container.id,
      productId: product.id,
      productName: product.name || line.productName || line.product_name || product.id,
      draftId: draft.id || "",
      invoiceId: draft.invoice_id || "",
      invoiceNumber: draft.invoice_number || "",
      serviceId: draft.service_id || "",
      serviceName: draft.service_name || "",
      clientId: draft.client_id || "",
      clientName: draft.client_name || "",
      staffId: draft.staff_id || "",
      staffName: draft.staff_name || "",
      usedQty,
      unit,
      productCost,
      usageType: line.usageType || line.usage_type || "client",
      reason: line.reason || "",
      balanceAfter,
      createdBy: access.userId || "",
      createdAt: now()
    });
    return mapUsage(db.prepare("SELECT * FROM backbar_product_usage_entries WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  createAlert({ access = {}, branchId = "", productId = "", containerId = "", draftId = "", invoiceId = "", alertType = "", severity = "info", title = "", message = "", evidence = {} } = {}) {
    const id = makeId("bbal");
    db.prepare(`
      INSERT INTO backbar_product_alerts (
        id, tenant_id, branch_id, productId, containerId, draftId, invoiceId, alertType,
        severity, title, message, evidenceJson, status, createdAt
      ) VALUES (
        @id, @tenant_id, @branch_id, @productId, @containerId, @draftId, @invoiceId, @alertType,
        @severity, @title, @message, @evidenceJson, 'open', @createdAt
      )
    `).run({
      id,
      tenant_id: access.tenantId,
      branch_id: branchId,
      productId,
      containerId,
      draftId,
      invoiceId,
      alertType,
      severity,
      title,
      message,
      evidenceJson: toJson(evidence),
      createdAt: now()
    });
    return mapAlert(db.prepare("SELECT * FROM backbar_product_alerts WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
  }

  ownerReport(query = {}, access = {}) {
    ensureBackbarSchema();
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || access.branchId || "";
    if (branchId) assertBranch(access, branchId);
    const params = { tenant_id: access.tenantId, limit: Math.min(500, Math.max(1, number(query.limit, 100))) };
    const filters = ["tenant_id = @tenant_id"];
    if (branchId) {
      filters.push("branch_id = @branch_id");
      params.branch_id = branchId;
    }
    const where = filters.join(" AND ");
    const containers = db.prepare(`SELECT * FROM backbar_product_containers WHERE ${where} ORDER BY updatedAt DESC LIMIT @limit`).all(params).map(mapContainer);
    const entries = db.prepare(`SELECT * FROM backbar_product_usage_entries WHERE ${where} ORDER BY createdAt DESC LIMIT @limit`).all(params).map(mapUsage);
    const alerts = db.prepare(`SELECT * FROM backbar_product_alerts WHERE ${where} ORDER BY createdAt DESC LIMIT @limit`).all(params).map(mapAlert);
    const productIds = [...new Set(containers.map((container) => container.productId).filter(Boolean))];
    const products = productIds.length
      ? db.prepare(`SELECT * FROM products WHERE tenantId = ? AND id IN (${placeholders(productIds)})`).all(access.tenantId, ...productIds)
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));
    const rows = productIds.map((productId) => {
      const product = productById.get(productId) || { id: productId, name: productId, stock: 0 };
      const productContainers = containers.filter((container) => container.productId === productId);
      const nonFinished = productContainers.filter((container) => container.status !== "finished");
      const productEntries = entries.filter((entry) => entry.productId === productId);
      const productAlerts = alerts.filter((alert) => alert.productId === productId);
      return {
        productId,
        productName: product.name || productId,
        stockUnit: productContainers[0]?.stockUnit || product.unit || "pcs",
        measureUnit: productContainers[0]?.measureUnit || product.packUnit || product.unit || "pcs",
        sealedStock: Math.max(0, money(number(product.stock, 0) - nonFinished.length)),
        openCount: productContainers.filter((container) => container.status === "open").length,
        pausedCount: productContainers.filter((container) => container.status === "paused_override").length,
        finishedCount: productContainers.filter((container) => container.status === "finished").length,
        totalUsedText: usageText(productEntries),
        usageCost: money(productEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        alertCount: productAlerts.filter((alert) => alert.status === "open").length,
        lastUsedAt: productEntries[0]?.createdAt || ""
      };
    }).sort((a, b) => Number(b.alertCount || 0) - Number(a.alertCount || 0) || String(b.lastUsedAt || "").localeCompare(String(a.lastUsedAt || "")));
    return {
      branchId,
      summary: {
        trackedProducts: rows.length,
        openContainers: containers.filter((container) => container.status === "open").length,
        pausedContainers: containers.filter((container) => container.status === "paused_override").length,
        finishedContainers: containers.filter((container) => container.status === "finished").length,
        clientUsageEntries: entries.filter((entry) => entry.usageType === "client").length,
        adjustmentEntries: entries.filter((entry) => entry.usageType !== "client").length,
        openAlerts: alerts.filter((alert) => alert.status === "open").length,
        usageCost: money(entries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0))
      },
      products: rows,
      containers,
      recentEntries: entries,
      alerts
    };
  }

  ownerDashboard(query = {}, access = {}) {
    ensureBackbarSchema();
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || access.branchId || "";
    if (branchId) assertBranch(access, branchId);
    const today = now().slice(0, 10);
    const period = String(query.period || "daily").toLowerCase() === "weekly" ? "weekly" : "daily";
    const fallbackStart = new Date(`${today}T00:00:00.000Z`);
    if (period === "weekly") fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 6);
    const startDate = String(query.startDate || query.start_date || fallbackStart.toISOString().slice(0, 10));
    const endDate = String(query.endDate || query.end_date || today);
    const scopeParams = { tenant_id: access.tenantId };
    const branchFilter = branchId ? " AND branch_id = @branch_id" : "";
    if (branchId) scopeParams.branch_id = branchId;
    const periodParams = { ...scopeParams, start_date: startDate, end_date: endDate };

    const containers = db.prepare(`
      SELECT * FROM backbar_product_containers
      WHERE tenant_id = @tenant_id${branchFilter}
      ORDER BY updatedAt DESC
      LIMIT 1000
    `).all(scopeParams).map(mapContainer);
    const entries = db.prepare(`
      SELECT * FROM backbar_product_usage_entries
      WHERE tenant_id = @tenant_id${branchFilter}
        AND substr(createdAt, 1, 10) >= @start_date
        AND substr(createdAt, 1, 10) <= @end_date
      ORDER BY createdAt DESC
      LIMIT 1000
    `).all(periodParams).map(mapUsage);
    const alerts = db.prepare(`
      SELECT * FROM backbar_product_alerts
      WHERE tenant_id = @tenant_id${branchFilter}
        AND status = 'open'
      ORDER BY createdAt DESC
      LIMIT 500
    `).all(scopeParams).map(mapAlert);
    const approvalRequests = this.listOverrideRequests({ branchId, status: "pending", limit: 100 }, access).requests;
    const productIds = [...new Set(containers.map((container) => container.productId).filter(Boolean))];
    const products = productIds.length
      ? db.prepare(`SELECT * FROM products WHERE tenantId = ? AND id IN (${placeholders(productIds)})`).all(access.tenantId, ...productIds)
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));
    const advancedAlerts = [];

    for (const container of containers.filter((row) => row.status !== "finished")) {
      const product = productById.get(container.productId) || {};
      const openDays = daysOpen(container.openedAt);
      if (openDays >= number(query.openDaysThreshold, 14)) {
        advancedAlerts.push({
          alertType: "open_container_age",
          severity: "medium",
          productId: container.productId,
          productName: container.productName,
          title: `${container.productName} container open ${openDays} days`,
          message: `${container.stockUnit} #${container.containerNo} abhi bhi ${container.balanceQty} ${container.measureUnit} balance hai.`,
          evidence: { containerId: container.id, containerNo: container.containerNo, openDays }
        });
      }
      if (container.capacityQty > 0 && (container.balanceQty / container.capacityQty) * 100 <= LOW_BALANCE_PCT) {
        advancedAlerts.push({
          alertType: "low_balance",
          severity: "medium",
          productId: container.productId,
          productName: container.productName,
          title: `${container.productName} low balance`,
          message: `${container.balanceQty} ${container.measureUnit} left in ${container.stockUnit} #${container.containerNo}.`,
          evidence: { containerId: container.id, balanceQty: container.balanceQty, capacityQty: container.capacityQty }
        });
      }
      const expiry = product.expiryDate || product.expiry_date || product.expiry || product.expiresAt || product.expires_at || "";
      const expiryDays = expiry ? Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000) : null;
      if (expiryDays !== null && expiryDays >= 0 && expiryDays <= number(query.expiryDaysThreshold, 30)) {
        advancedAlerts.push({
          alertType: "expiry_near",
          severity: expiryDays <= 7 ? "high" : "medium",
          productId: container.productId,
          productName: container.productName,
          title: `${container.productName} expiry near`,
          message: `${expiryDays} days me expiry aa rahi hai.`,
          evidence: { expiry, expiryDays }
        });
      }
    }

    const byProduct = new Map();
    for (const entry of entries) {
      const row = byProduct.get(entry.productId) || { productId: entry.productId, productName: entry.productName, totalQty: 0, exceptionQty: 0, exceptionCost: 0, clientEntries: 0, exceptionEntries: 0 };
      row.totalQty = money(row.totalQty + number(entry.usedQty, 0));
      if (entry.usageType === "client") row.clientEntries += 1;
      else {
        row.exceptionQty = money(row.exceptionQty + number(entry.usedQty, 0));
        row.exceptionCost = money(row.exceptionCost + number(entry.productCost, 0));
        row.exceptionEntries += 1;
      }
      byProduct.set(entry.productId, row);
    }
    for (const row of byProduct.values()) {
      if (row.totalQty > 0 && row.exceptionQty / row.totalQty >= 0.25) {
        advancedAlerts.push({
          alertType: "high_wastage_trend",
          severity: "high",
          productId: row.productId,
          productName: row.productName,
          title: `${row.productName} wastage high`,
          message: `${row.exceptionQty} of ${row.totalQty} used qty is waste/adjustment in this period.`,
          evidence: row
        });
      }
      if (row.exceptionEntries > row.clientEntries && row.exceptionEntries >= 2) {
        advancedAlerts.push({
          alertType: "leakage_risk",
          severity: "high",
          productId: row.productId,
          productName: row.productName,
          title: `${row.productName} leakage risk`,
          message: `Adjustment entries client usage se zyada hain. Stock aur client usage match review karo.`,
          evidence: row
        });
      }
    }

    const serviceProfit = this.serviceProfitSnapshot({ branchId, startDate, endDate }, access);
    for (const row of serviceProfit.overuseRows.slice(0, 8)) {
      advancedAlerts.push({
        alertType: "repeated_overuse",
        severity: row.count >= 3 ? "high" : "medium",
        productId: row.productId,
        productName: row.productName,
        title: `${row.staffName || "Staff"} repeated overuse`,
        message: `${row.count} overuse lines for ${row.productName} / ${row.serviceName}.`,
        evidence: row
      });
    }

    return {
      branchId,
      period,
      startDate,
      endDate,
      summary: {
        openContainers: containers.filter((container) => container.status === "open").length,
        finishedContainers: containers.filter((container) => container.status === "finished").length,
        usageCost: money(entries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        exceptionCost: money(entries.filter((entry) => entry.usageType !== "client").reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        advancedAlerts: advancedAlerts.length + alerts.length,
        pendingApprovals: approvalRequests.length,
        serviceRevenue: serviceProfit.summary.serviceRevenue,
        productCost: serviceProfit.summary.productCost,
        actualProfit: serviceProfit.summary.actualProfit
      },
      advancedAlerts: [...advancedAlerts, ...alerts].slice(0, 80),
      approvalRequests,
      serviceProfit: serviceProfit.rows
    };
  }

  controlLedgerReport(query = {}, access = {}) {
    ensureBackbarSchema();
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || access.branchId || "";
    if (branchId) assertBranch(access, branchId);
    const productId = query.productId || query.product_id || "";
    const staffId = query.staffId || query.staff_id || "";
    const clientId = query.clientId || query.client_id || "";
    const serviceId = query.serviceId || query.service_id || "";
    const usageType = query.usageType || query.usage_type || "";
    const startDate = query.startDate || query.start_date || "";
    const endDate = query.endDate || query.end_date || "";
    const limit = Math.min(1000, Math.max(1, number(query.limit, 300)));

    const scopeParams = { tenant_id: access.tenantId, limit };
    const scopeFilters = ["tenant_id = @tenant_id"];
    if (branchId) {
      scopeFilters.push("branch_id = @branch_id");
      scopeParams.branch_id = branchId;
    }
    if (productId) {
      scopeFilters.push("productId = @productId");
      scopeParams.productId = productId;
    }

    const entryParams = { ...scopeParams };
    const entryFilters = [...scopeFilters];
    if (staffId) {
      entryFilters.push("staffId = @staffId");
      entryParams.staffId = staffId;
    }
    if (clientId) {
      entryFilters.push("clientId = @clientId");
      entryParams.clientId = clientId;
    }
    if (serviceId) {
      entryFilters.push("serviceId = @serviceId");
      entryParams.serviceId = serviceId;
    }
    if (usageType) {
      entryFilters.push("usageType = @usageType");
      entryParams.usageType = usageType;
    }
    if (startDate) {
      entryFilters.push("substr(createdAt, 1, 10) >= @startDate");
      entryParams.startDate = startDate;
    }
    if (endDate) {
      entryFilters.push("substr(createdAt, 1, 10) <= @endDate");
      entryParams.endDate = endDate;
    }

    const containers = db.prepare(`
      SELECT * FROM backbar_product_containers
      WHERE ${scopeFilters.join(" AND ")}
      ORDER BY updatedAt DESC
      LIMIT @limit
    `).all(scopeParams).map(mapContainer);
    const entries = db.prepare(`
      SELECT * FROM backbar_product_usage_entries
      WHERE ${entryFilters.join(" AND ")}
      ORDER BY createdAt DESC
      LIMIT @limit
    `).all(entryParams).map(mapUsage);
    const alerts = db.prepare(`
      SELECT * FROM backbar_product_alerts
      WHERE ${scopeFilters.join(" AND ")}
      ORDER BY createdAt DESC
      LIMIT @limit
    `).all(scopeParams).map(mapAlert);
    const approvals = db.prepare(`
      SELECT * FROM backbar_override_requests
      WHERE ${scopeFilters.join(" AND ")}
      ORDER BY createdAt DESC
      LIMIT @limit
    `).all(scopeParams).map(mapOverrideRequest);
    const productIds = [...new Set([
      ...containers.map((container) => container.productId),
      ...entries.map((entry) => entry.productId),
      productId
    ].filter(Boolean))];
    const products = productIds.length
      ? db.prepare(`SELECT * FROM products WHERE tenantId = ? AND id IN (${placeholders(productIds)})`).all(access.tenantId, ...productIds)
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));

    const clientEntries = entries.filter((entry) => entry.usageType === "client");
    const exceptionEntries = entries.filter((entry) => entry.usageType !== "client");
    const productRows = groupUsageRows(entries, (entry) => entry.productId || entry.productName || "product", (entry) => ({
      productId: entry.productId || "",
      productName: entry.productName || "Product"
    }));
    const staffRows = groupUsageRows(entries, (entry) => entry.staffId || entry.staffName || "unassigned", (entry) => ({
      staffId: entry.staffId || "",
      staffName: entry.staffName || "Unassigned"
    }));
    const serviceRows = groupUsageRows(clientEntries, (entry) => entry.serviceId || entry.serviceName || "service", (entry) => ({
      serviceId: entry.serviceId || "",
      serviceName: entry.serviceName || "Service"
    }));
    const clientRows = groupUsageRows(clientEntries, (entry) => entry.clientId || entry.invoiceId || entry.clientName || "walk-in", (entry) => ({
      clientId: entry.clientId || "",
      clientName: entry.clientName || "Walk-in client",
      invoiceNumber: entry.invoiceNumber || ""
    }));
    const wasteRows = groupUsageRows(exceptionEntries, (entry) => entry.usageType || "manual_adjustment", (entry) => ({
      usageType: entry.usageType || "manual_adjustment",
      reason: entry.reason || ""
    }));
    const draftParams = { tenant_id: access.tenantId, limit };
    const draftFilters = ["tenant_id = @tenant_id", "status = 'confirmed'"];
    if (branchId) {
      draftFilters.push("branch_id = @branch_id");
      draftParams.branch_id = branchId;
    }
    if (staffId) {
      draftFilters.push("staff_id = @staffId");
      draftParams.staffId = staffId;
    }
    if (clientId) {
      draftFilters.push("client_id = @clientId");
      draftParams.clientId = clientId;
    }
    if (serviceId) {
      draftFilters.push("service_id = @serviceId");
      draftParams.serviceId = serviceId;
    }
    if (startDate) {
      draftFilters.push("substr(updated_at, 1, 10) >= @startDate");
      draftParams.startDate = startDate;
    }
    if (endDate) {
      draftFilters.push("substr(updated_at, 1, 10) <= @endDate");
      draftParams.endDate = endDate;
    }
    const draftRows = tableExists("product_consume_drafts")
      ? db.prepare(`SELECT * FROM product_consume_drafts WHERE ${draftFilters.join(" AND ")} ORDER BY updated_at DESC LIMIT @limit`).all(draftParams)
      : [];
    const varianceMap = new Map();
    for (const draft of draftRows) {
      for (const line of parseLineItems(draft)) {
        const lineProductId = line.productId || line.product_id || "";
        if (productId && lineProductId !== productId) continue;
        const actualQty = number(line.actualQty ?? line.actual_qty, 0);
        const expectedQty = number(line.expectedQty ?? line.expected_qty, 0);
        const maxQty = number(line.maxQty ?? line.max_qty, 0);
        const varianceQty = money(actualQty - expectedQty);
        const isOver = (maxQty > 0 && actualQty > maxQty) || (expectedQty > 0 && actualQty > expectedQty * 1.15);
        if (!isOver && varianceQty <= 0) continue;
        const key = `${lineProductId}|${draft.staff_id}|${draft.service_id}`;
        const row = varianceMap.get(key) || {
          productId: lineProductId,
          productName: line.productName || line.product_name || lineProductId || "Product",
          staffId: draft.staff_id || "",
          staffName: draft.staff_name || "Unassigned",
          serviceId: draft.service_id || "",
          serviceName: draft.service_name || "Service",
          count: 0,
          expectedQty: 0,
          actualQty: 0,
          varianceQty: 0,
          cost: 0,
          reasonCount: 0,
          lastUsedAt: ""
        };
        row.count += 1;
        row.expectedQty = money(row.expectedQty + expectedQty);
        row.actualQty = money(row.actualQty + actualQty);
        row.varianceQty = money(row.actualQty - row.expectedQty);
        row.cost = money(row.cost + number(line.actualCost ?? line.actual_cost, 0));
        if (String(line.reason || line.overuseReason || line.overuse_reason || "").trim()) row.reasonCount += 1;
        row.lastUsedAt = draft.updated_at || draft.created_at || row.lastUsedAt;
        varianceMap.set(key, row);
      }
    }
    const varianceRows = [...varianceMap.values()].sort((a, b) => Number(b.varianceQty || 0) - Number(a.varianceQty || 0)).slice(0, 80);
    const containerRiskRows = containers
      .filter((container) => container.status !== "finished")
      .map((container) => {
        const product = productById.get(container.productId) || {};
        const openDays = daysOpen(container.openedAt);
        const balancePct = container.capacityQty > 0 ? money((container.balanceQty / container.capacityQty) * 100) : 0;
        const expiry = product.expiryDate || product.expiry_date || product.expiry || product.expiresAt || product.expires_at || "";
        const expiryDays = expiry ? Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000) : null;
        const riskScore = (openDays >= 14 ? 35 : 0) + (balancePct <= LOW_BALANCE_PCT && container.capacityQty > 0 ? 25 : 0) + (expiryDays !== null && expiryDays <= 30 ? 40 : 0);
        return {
          productId: container.productId,
          productName: container.productName,
          containerId: container.id,
          containerNo: container.containerNo,
          status: container.status,
          openDays,
          balanceQty: container.balanceQty,
          balancePct,
          measureUnit: container.measureUnit,
          expiry,
          expiryDays,
          riskScore,
          riskLevel: riskScore >= 60 ? "high" : riskScore >= 25 ? "medium" : "watch"
        };
      })
      .filter((row) => row.riskScore > 0)
      .sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0))
      .slice(0, 80);
    const leakageRows = productRows.map((row) => {
      const productContainers = containers.filter((container) => container.productId === row.productId);
      const productExceptions = exceptionEntries.filter((entry) => entry.productId === row.productId);
      const productClientEntries = clientEntries.filter((entry) => entry.productId === row.productId);
      const exceptionCost = money(productExceptions.reduce((sum, entry) => sum + number(entry.productCost, 0), 0));
      const clientCost = money(productClientEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0));
      const exceptionRatio = row.cost > 0 ? money((exceptionCost / row.cost) * 100) : 0;
      const openOldCount = productContainers.filter((container) => container.status !== "finished" && daysOpen(container.openedAt) >= 14).length;
      const riskScore = Math.min(100, Math.round(exceptionRatio + openOldCount * 15 + Math.max(0, number(row.exceptionCount, 0) - productClientEntries.length) * 10));
      return {
        productId: row.productId,
        productName: row.productName,
        totalUsedText: row.totalUsedText,
        clientEntries: productClientEntries.length,
        exceptionEntries: productExceptions.length,
        clientCost,
        exceptionCost,
        exceptionRatio,
        openOldCount,
        riskScore,
        riskLevel: riskScore >= 60 ? "high" : riskScore >= 25 ? "medium" : "watch"
      };
    }).filter((row) => row.riskScore > 0).sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0)).slice(0, 80);
    const branchRows = groupUsageRows(entries, (entry) => entry.branchId || "all", (entry) => ({
      branchId: entry.branchId || "",
      branchName: entry.branchId || "All branches"
    })).map((row) => {
      const branchEntries = entries.filter((entry) => (entry.branchId || "all") === (row.branchId || "all"));
      const branchExceptions = branchEntries.filter((entry) => entry.usageType !== "client");
      return {
        ...row,
        clientEntries: branchEntries.filter((entry) => entry.usageType === "client").length,
        exceptionEntries: branchExceptions.length,
        exceptionCost: money(branchExceptions.reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        exceptionRatio: row.cost > 0 ? money((branchExceptions.reduce((sum, entry) => sum + number(entry.productCost, 0), 0) / row.cost) * 100) : 0
      };
    });
    const supplierMap = new Map();
    for (const entry of entries) {
      const product = productById.get(entry.productId) || {};
      const supplierId = product.supplierId || product.supplier_id || product.supplier || "unlinked";
      const supplierName = product.supplierName || product.supplier_name || product.supplier || supplierId || "Unlinked supplier";
      const row = supplierMap.get(supplierId) || {
        supplierId,
        supplierName,
        products: new Set(),
        entries: 0,
        exceptionEntries: 0,
        usageCost: 0,
        exceptionCost: 0,
        qualityScore: 100,
        lastUsedAt: ""
      };
      row.products.add(entry.productId);
      row.entries += 1;
      row.usageCost = money(row.usageCost + number(entry.productCost, 0));
      if (entry.usageType !== "client") {
        row.exceptionEntries += 1;
        row.exceptionCost = money(row.exceptionCost + number(entry.productCost, 0));
      }
      row.lastUsedAt = String(entry.createdAt || "").localeCompare(String(row.lastUsedAt || "")) > 0 ? entry.createdAt : row.lastUsedAt;
      supplierMap.set(supplierId, row);
    }
    const supplierRows = [...supplierMap.values()].map((row) => {
      const exceptionRatio = row.usageCost > 0 ? money((row.exceptionCost / row.usageCost) * 100) : 0;
      return {
        ...row,
        productCount: row.products.size,
        products: undefined,
        exceptionRatio,
        qualityScore: Math.max(0, Math.round(100 - exceptionRatio))
      };
    }).sort((a, b) => Number(a.qualityScore || 0) - Number(b.qualityScore || 0) || Number(b.exceptionCost || 0) - Number(a.exceptionCost || 0)).slice(0, 80);
    const approvalRows = approvals.map((request) => ({
      ...request,
      ageHours: request.status === "pending" && request.createdAt ? Math.max(0, Math.round((Date.now() - new Date(request.createdAt).getTime()) / 3600000)) : 0,
      activeBalanceText: `${request.activeBalanceQty || 0} ${request.measureUnit || ""}`.trim()
    })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 80);
    const entityLedger = [
      ...entries.map((entry) => ({
        entityType: entry.usageType === "client" ? "client_usage" : "exception_usage",
        entityId: entry.id,
        productId: entry.productId,
        title: entry.usageType === "client" ? `${entry.clientName || "Walk-in client"} · ${entry.productName}` : `${entry.usageType} · ${entry.productName}`,
        detail: `${entry.usedQty} ${entry.unit} · ${entry.serviceName || entry.reason || entry.invoiceNumber || "Product consume"}`,
        eventAt: entry.createdAt || ""
      })),
      ...approvals.map((request) => ({
        entityType: "approval",
        entityId: request.id,
        productId: request.productId,
        title: `${request.status} override · ${request.productName}`,
        detail: `${request.activeBalanceQty} ${request.measureUnit} left in #${request.activeContainerNo} · ${request.reason}`,
        eventAt: request.updatedAt || request.createdAt || ""
      })),
      ...alerts.map((alert) => ({
        entityType: "alert",
        entityId: alert.id,
        productId: alert.productId,
        title: alert.title || alert.alertType,
        detail: alert.message || "",
        eventAt: alert.createdAt || ""
      }))
    ].sort((a, b) => String(b.eventAt || "").localeCompare(String(a.eventAt || ""))).slice(0, limit);

    return {
      branchId,
      filters: { productId, staffId, clientId, serviceId, usageType, startDate, endDate, limit },
      summary: {
        products: productRows.length,
        staff: staffRows.length,
        clients: clientRows.length,
        services: serviceRows.length,
        containers: containers.length,
        openContainers: containers.filter((container) => container.status === "open").length,
        clientUsageText: usageText(clientEntries),
        exceptionUsageText: usageText(exceptionEntries),
        usageCost: money(entries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        exceptionCost: money(exceptionEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        alerts: alerts.filter((alert) => alert.status === "open").length,
        pendingApprovals: approvals.filter((request) => request.status === "pending").length,
        varianceRows: varianceRows.length,
        containerRisks: containerRiskRows.length,
        leakageRisks: leakageRows.length,
        branches: branchRows.length,
        suppliers: supplierRows.length,
        approvalHistory: approvalRows.length
      },
      productRows,
      staffRows,
      serviceRows,
      clientRows,
      wasteRows,
      varianceRows,
      containerRiskRows,
      leakageRows,
      branchRows,
      supplierRows,
      approvalRows,
      approvals,
      alerts,
      recentEntries: entries,
      entityLedger
    };
  }

  serviceProfitSnapshot({ branchId = "", startDate = "", endDate = "" } = {}, access = {}) {
    if (!tableExists("product_consume_drafts")) {
      return { summary: { serviceRevenue: 0, productCost: 0, actualProfit: 0 }, rows: [], overuseRows: [] };
    }
    const params = { tenant_id: access.tenantId, start_date: startDate, end_date: endDate };
    const filters = ["tenant_id = @tenant_id", "status = 'confirmed'"];
    if (branchId) {
      filters.push("branch_id = @branch_id");
      params.branch_id = branchId;
    }
    if (startDate) filters.push("substr(updated_at, 1, 10) >= @start_date");
    if (endDate) filters.push("substr(updated_at, 1, 10) <= @end_date");
    const drafts = db.prepare(`SELECT * FROM product_consume_drafts WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC LIMIT 1000`).all(params);
    const invoiceIds = [...new Set(drafts.map((draft) => draft.invoice_id).filter(Boolean))];
    const invoiceItems = tableExists("invoice_items") && invoiceIds.length
      ? db.prepare(`SELECT * FROM invoice_items WHERE tenant_id = ? AND invoice_id IN (${placeholders(invoiceIds)})`).all(access.tenantId, ...invoiceIds)
      : [];
    const itemsByInvoice = new Map();
    for (const item of invoiceItems) {
      const rows = itemsByInvoice.get(item.invoice_id) || [];
      rows.push(item);
      itemsByInvoice.set(item.invoice_id, rows);
    }
    const overuse = new Map();
    const byService = new Map();
    for (const draft of drafts) {
      const lines = parseLineItems(draft);
      const productCost = money(number(draft.actual_cost, 0));
      const serviceItems = (itemsByInvoice.get(draft.invoice_id) || []).filter((item) => item.item_type === "service");
      const matched = serviceItems.find((item) => item.item_id === draft.service_id || item.appointment_service_id === draft.service_id)
        || (serviceItems.length === 1 ? serviceItems[0] : null);
      const revenue = money(number(matched?.total_amount, 0));
      const key = draft.service_id || draft.service_name || "unknown";
      const row = byService.get(key) || {
        serviceId: draft.service_id || "",
        serviceName: draft.service_name || "Service",
        invoiceCount: 0,
        serviceRevenue: 0,
        productCost: 0,
        actualProfit: 0,
        profitMarginPct: 0,
        revenueLinked: 0
      };
      row.invoiceCount += 1;
      row.serviceRevenue = money(row.serviceRevenue + revenue);
      row.productCost = money(row.productCost + productCost);
      row.actualProfit = money(row.serviceRevenue - row.productCost);
      row.revenueLinked += revenue > 0 ? 1 : 0;
      row.profitMarginPct = row.serviceRevenue > 0 ? money((row.actualProfit / row.serviceRevenue) * 100) : 0;
      byService.set(key, row);

      for (const line of lines) {
        const actualQty = number(line.actualQty ?? line.actual_qty, 0);
        const expectedQty = number(line.expectedQty ?? line.expected_qty, 0);
        const maxQty = number(line.maxQty ?? line.max_qty, 0);
        if ((maxQty > 0 && actualQty > maxQty) || (expectedQty > 0 && actualQty > expectedQty * 1.15)) {
          const overKey = `${draft.staff_id}|${draft.service_id}|${line.productId || line.product_id}`;
          const item = overuse.get(overKey) || {
            staffId: draft.staff_id || "",
            staffName: draft.staff_name || "",
            serviceId: draft.service_id || "",
            serviceName: draft.service_name || "",
            productId: line.productId || line.product_id || "",
            productName: line.productName || line.product_name || "",
            count: 0,
            lastUsedAt: ""
          };
          item.count += 1;
          item.lastUsedAt = draft.updated_at || draft.created_at || item.lastUsedAt;
          overuse.set(overKey, item);
        }
      }
    }
    const rows = [...byService.values()].sort((a, b) => Number(b.productCost || 0) - Number(a.productCost || 0));
    return {
      summary: {
        serviceRevenue: money(rows.reduce((sum, row) => sum + number(row.serviceRevenue, 0), 0)),
        productCost: money(rows.reduce((sum, row) => sum + number(row.productCost, 0), 0)),
        actualProfit: money(rows.reduce((sum, row) => sum + number(row.actualProfit, 0), 0))
      },
      rows,
      overuseRows: [...overuse.values()].filter((row) => row.count >= 2).sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    };
  }

  productReport(productId, query = {}, access = {}) {
    ensureBackbarSchema();
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || "";
    const product = loadProduct(productId, access, branchId);
    const params = { tenant_id: access.tenantId, productId, limit: Math.min(500, Math.max(1, number(query.limit, 200))) };
    const filters = ["tenant_id = @tenant_id", "productId = @productId"];
    if (branchId || product.branchId) {
      params.branch_id = branchId || product.branchId;
      filters.push("branch_id = @branch_id");
    }
    const where = filters.join(" AND ");
    const containers = db.prepare(`SELECT * FROM backbar_product_containers WHERE ${where} ORDER BY containerNo ASC`).all(params).map(mapContainer);
    const entries = db.prepare(`SELECT * FROM backbar_product_usage_entries WHERE ${where} ORDER BY createdAt DESC LIMIT @limit`).all(params).map(mapUsage);
    const alerts = db.prepare(`SELECT * FROM backbar_product_alerts WHERE ${where} ORDER BY createdAt DESC LIMIT @limit`).all(params).map(mapAlert);
    const nonFinished = containers.filter((container) => container.status !== "finished");
    const clientEntries = entries.filter((entry) => entry.usageType === "client");
    const adjustmentEntries = entries.filter((entry) => entry.usageType !== "client");
    const invoiceIds = [...new Set(clientEntries.map((entry) => entry.invoiceId).filter(Boolean))];
    const invoiceItems = tableExists("invoice_items") && invoiceIds.length
      ? db.prepare(`SELECT * FROM invoice_items WHERE tenant_id = ? AND invoice_id IN (${placeholders(invoiceIds)})`).all(access.tenantId, ...invoiceIds)
      : [];
    const itemsByInvoice = new Map();
    for (const item of invoiceItems) {
      const rows = itemsByInvoice.get(item.invoice_id) || [];
      rows.push(item);
      itemsByInvoice.set(item.invoice_id, rows);
    }
    const serviceUsage = groupUsageRows(clientEntries, (entry) => entry.serviceId || entry.serviceName || "service", (entry) => ({
      serviceId: entry.serviceId || "",
      serviceName: entry.serviceName || "Service",
      serviceRevenue: 0,
      productCost: 0,
      actualProfit: 0,
      profitMarginPct: 0,
      revenueLinked: 0
    })).map((row) => {
      const related = clientEntries.filter((entry) => (entry.serviceId || entry.serviceName || "service") === (row.serviceId || row.serviceName || "service"));
      let serviceRevenue = 0;
      let revenueLinked = 0;
      for (const entry of related) {
        const serviceItems = (itemsByInvoice.get(entry.invoiceId) || []).filter((item) => item.item_type === "service");
        const matched = serviceItems.find((item) => item.item_id === entry.serviceId || item.appointment_service_id === entry.serviceId)
          || (serviceItems.length === 1 ? serviceItems[0] : null);
        const revenue = money(matched?.total_amount || 0);
        serviceRevenue = money(serviceRevenue + revenue);
        if (revenue > 0) revenueLinked += 1;
      }
      const productCost = money(row.cost);
      const actualProfit = money(serviceRevenue - productCost);
      return {
        ...row,
        serviceRevenue,
        productCost,
        actualProfit,
        revenueLinked,
        profitMarginPct: serviceRevenue > 0 ? money((actualProfit / serviceRevenue) * 100) : 0
      };
    });
    const staffUsage = groupUsageRows(entries, (entry) => entry.staffId || entry.staffName || "unassigned", (entry) => ({
      staffId: entry.staffId || "",
      staffName: entry.staffName || "Unassigned"
    }));
    const clientUsage = groupUsageRows(clientEntries, (entry) => entry.clientId || entry.invoiceId || entry.clientName || "walk-in", (entry) => ({
      clientId: entry.clientId || "",
      clientName: entry.clientName || "Walk-in client",
      invoiceNumber: entry.invoiceNumber || "",
      serviceName: entry.serviceName || ""
    }));
    const wastageByType = groupUsageRows(adjustmentEntries, (entry) => entry.usageType || "manual_adjustment", (entry) => ({
      usageType: entry.usageType || "manual_adjustment",
      reason: entry.reason || ""
    }));
    const approvals = db.prepare(`
      SELECT * FROM backbar_override_requests
      WHERE tenant_id = @tenant_id AND productId = @productId
        ${branchId || product.branchId ? "AND branch_id = @branch_id" : ""}
      ORDER BY createdAt DESC
      LIMIT @limit
    `).all(params).map(mapOverrideRequest);
    const entityLedger = [
      ...containers.map((container) => ({
        entityType: "container",
        entityId: container.id,
        title: `${container.containerCode} ${container.status}`,
        detail: `${container.usedQty} ${container.measureUnit} used, ${container.balanceQty} ${container.measureUnit} left`,
        eventAt: container.updatedAt || container.createdAt || container.openedAt || ""
      })),
      ...entries.map((entry) => ({
        entityType: entry.usageType === "client" ? "client_usage" : "adjustment",
        entityId: entry.id,
        title: entry.usageType === "client" ? `${entry.clientName || "Walk-in client"} usage` : `${entry.usageType} entry`,
        detail: `${entry.usedQty} ${entry.unit} · ${entry.serviceName || entry.reason || entry.invoiceNumber || "Product consume"}`,
        eventAt: entry.createdAt || ""
      })),
      ...approvals.map((request) => ({
        entityType: "approval",
        entityId: request.id,
        title: `${request.status} override request`,
        detail: `${request.activeBalanceQty} ${request.measureUnit} left · ${request.reason}`,
        eventAt: request.updatedAt || request.createdAt || ""
      })),
      ...alerts.map((alert) => ({
        entityType: "alert",
        entityId: alert.id,
        title: alert.title || alert.alertType,
        detail: alert.message || "",
        eventAt: alert.createdAt || ""
      }))
    ].sort((a, b) => String(b.eventAt || "").localeCompare(String(a.eventAt || ""))).slice(0, 120);
    const totalRevenue = money(serviceUsage.reduce((sum, row) => sum + number(row.serviceRevenue, 0), 0));
    const totalProductCost = money(entries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0));
    const totalWastageCost = money(adjustmentEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0));
    const activeContainer = containers.find((container) => container.status === "open") || null;
    const reportCards = [
      { key: "container_control", label: "Container-level control", status: containers.length ? "active" : "waiting", metric: `${containers.length} containers` },
      { key: "client_usage", label: "Per-client consumption", status: clientEntries.length ? "active" : "waiting", metric: `${clientEntries.length} client entries` },
      { key: "recipe_control", label: "Recipe / range control", status: alerts.some((alert) => alert.alertType === "recipe_overuse") ? "attention" : "active", metric: `${alerts.filter((alert) => alert.alertType === "recipe_overuse").length} overuse alerts` },
      { key: "wastage_control", label: "Wastage split", status: adjustmentEntries.length ? "active" : "clean", metric: `${adjustmentEntries.length} exceptions` },
      { key: "entity_ledger", label: "Entity-level ledger", status: entityLedger.length ? "active" : "waiting", metric: `${entityLedger.length} events` },
      { key: "alerts", label: "Alerts", status: alerts.filter((alert) => alert.status === "open").length ? "attention" : "clean", metric: `${alerts.filter((alert) => alert.status === "open").length} open` },
      { key: "owner_reports", label: "Owner reports", status: "active", metric: `${staffUsage.length} staff rows` },
      { key: "profit_control", label: "Profit after product cost", status: totalRevenue ? "active" : "cost-only", metric: money(totalRevenue - totalProductCost) }
    ];
    return {
      productId,
      productName: product.name || productId,
      stockUnit: containers[0]?.stockUnit || product.unit || "pcs",
      measureUnit: containers[0]?.measureUnit || product.packUnit || product.unit || "pcs",
      capacityQty: containers[0]?.capacityQty || number(product.packSize, 0),
      summary: {
        productStock: number(product.stock, 0),
        sealedStock: Math.max(0, money(number(product.stock, 0) - nonFinished.length)),
        openContainers: containers.filter((container) => container.status === "open").length,
        pausedContainers: containers.filter((container) => container.status === "paused_override").length,
        finishedContainers: containers.filter((container) => container.status === "finished").length,
        totalUsedText: usageText(entries),
        clientUsedText: usageText(clientEntries),
        wastageText: usageText(adjustmentEntries),
        usageCost: money(entries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        clientUsageCost: money(clientEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0)),
        wastageCost: totalWastageCost,
        serviceRevenue: totalRevenue,
        actualProfit: money(totalRevenue - totalProductCost),
        openAlerts: alerts.filter((alert) => alert.status === "open").length,
        pendingApprovals: approvals.filter((request) => request.status === "pending").length,
        activeContainer
      },
      containers: containers.map((container) => ({
        ...container,
        entries: entries.filter((entry) => entry.containerId === container.id)
      })),
      entries,
      alerts,
      approvals,
      clientUsage,
      staffUsage,
      serviceUsage,
      wastageByType,
      entityLedger,
      reportCards
    };
  }

  adjustContainer(containerId, payload = {}, access = {}, consumeStockUnit) {
    ensureBackbarSchema();
    const container = db.prepare("SELECT * FROM backbar_product_containers WHERE id = ? AND tenant_id = ?").get(containerId, access.tenantId);
    if (!container) throw notFound("Backbar container not found");
    if (container.branch_id) assertBranch(access, container.branch_id);
    if (container.status === "finished") throw conflict("Finished container cannot be adjusted");
    const product = loadProduct(container.productId, access, container.branch_id || "");
    const usedQty = convertMeasureQty(payload.quantity ?? payload.usedQty, payload.unit || container.measureUnit, container.measureUnit);
    if (usedQty <= 0) throw conflict("Adjustment quantity must be above 0");
    if (usedQty > number(container.balanceQty, 0)) throw conflict("Adjustment quantity is higher than container balance");
    const usageType = String(payload.usageType || payload.reasonType || "manual_adjustment").trim() || "manual_adjustment";
    const balanceAfter = money(number(container.balanceQty, 0) - usedQty);
    const unitCost = number(product.unitCost, 0) && number(container.capacityQty, 0) ? money(number(product.unitCost, 0) / number(container.capacityQty, 0)) : 0;
    const entry = this.insertUsage({
      access,
      draft: {
        id: payload.draftId || "",
        branch_id: container.branch_id || "",
        invoice_id: payload.invoiceId || "",
        invoice_number: payload.invoiceNumber || "",
        service_id: "",
        service_name: usageType,
        client_id: "",
        client_name: "",
        staff_id: payload.staffId || "",
        staff_name: payload.staffName || ""
      },
      line: { usageType, reason: payload.reason || payload.notes || usageType },
      product,
      container,
      usedQty,
      unit: container.measureUnit,
      productCost: money(usedQty * unitCost),
      balanceAfter
    });
    db.prepare(`
      UPDATE backbar_product_containers
      SET usedQty = ?, balanceQty = ?, updatedBy = ?, updatedAt = ?
      WHERE id = ? AND tenant_id = ?
    `).run(money(number(container.usedQty, 0) + usedQty), balanceAfter, access.userId || "", now(), container.id, access.tenantId);
    const alerts = [this.createAlert({
      access,
      branchId: container.branch_id || "",
      productId: product.id,
      containerId: container.id,
      alertType: usageType,
      severity: ["expired", "damaged", "spillage"].includes(usageType) ? "high" : "medium",
      title: `${product.name} ${usageType.replace(/_/g, " ")}`,
      message: `${usedQty} ${container.measureUnit} adjusted. ${balanceAfter} ${container.measureUnit} left.`,
      evidence: { usedQty, balanceAfter, reason: payload.reason || payload.notes || "" }
    })];
    let deduction = null;
    if (balanceAfter <= 0) {
      deduction = consumeStockUnit({
        productId: product.id,
        branchId: container.branch_id,
        quantity: 1,
        unit: container.stockUnit,
        type: "backbar-container-adjusted-finished",
        reason: `${product.name} ${container.stockUnit} #${container.containerNo} finished by ${usageType}`,
        referenceType: "backbar_adjustment",
        referenceId: container.id,
        unitCost: number(product.unitCost, 0)
      });
      const transactionId = deduction?.deductions?.[0]?.transaction?.id || "";
      db.prepare(`
        UPDATE backbar_product_containers
        SET status = 'finished', balanceQty = 0, finishedAt = ?, stockTransactionId = ?, updatedBy = ?, updatedAt = ?
        WHERE id = ? AND tenant_id = ?
      `).run(now(), transactionId, access.userId || "", now(), container.id, access.tenantId);
    }
    return { container: mapContainer(db.prepare("SELECT * FROM backbar_product_containers WHERE id = ? AND tenant_id = ?").get(container.id, access.tenantId)), entry, alerts, deduction };
  }

  listOverrideRequests(query = {}, access = {}) {
    ensureBackbarSchema();
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || access.branchId || "";
    if (branchId) assertBranch(access, branchId);
    const params = { tenant_id: access.tenantId, limit: Math.min(200, Math.max(1, number(query.limit, 100))) };
    const filters = ["tenant_id = @tenant_id"];
    if (branchId) {
      filters.push("branch_id = @branch_id");
      params.branch_id = branchId;
    }
    if (query.status) {
      filters.push("status = @status");
      params.status = String(query.status);
    }
    if (query.productId || query.product_id) {
      filters.push("productId = @productId");
      params.productId = query.productId || query.product_id;
    }
    const requests = db.prepare(`
      SELECT * FROM backbar_override_requests
      WHERE ${filters.join(" AND ")}
      ORDER BY createdAt DESC
      LIMIT @limit
    `).all(params).map(mapOverrideRequest);
    return {
      branchId,
      summary: {
        total: requests.length,
        pending: requests.filter((row) => row.status === "pending").length,
        approved: requests.filter((row) => row.status === "approved").length,
        rejected: requests.filter((row) => row.status === "rejected").length
      },
      requests
    };
  }

  requestOverrideOpen(productId, payload = {}, access = {}) {
    ensureBackbarSchema();
    const branchId = payload.branchId || payload.branch_id || access.requestedBranchId || access.branchId || "";
    if (!branchId) throw conflict("branchId is required for override request");
    assertBranch(access, branchId);
    const reason = String(payload.reason || "").trim();
    if (!reason) throw conflict("Manager approval reason is required");
    const product = loadProduct(productId, access, branchId);
    const units = productUnits(product, payload);
    const active = db.prepare(`
      SELECT * FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId = ? AND status = 'open' AND balanceQty > 0
      ORDER BY containerNo ASC
      LIMIT 1
    `).get(access.tenantId, branchId, productId);
    if (!active) throw conflict("No active open container found. Next container will open automatically when needed.");
    const pending = db.prepare(`
      SELECT * FROM backbar_override_requests
      WHERE tenant_id = ? AND branch_id = ? AND productId = ? AND activeContainerId = ? AND status = 'pending'
      LIMIT 1
    `).get(access.tenantId, branchId, productId, active.id);
    if (pending) throw conflict("Pending manager approval already exists for this container");
    const id = makeId("bbor");
    const createdAt = now();
    db.prepare(`
      INSERT INTO backbar_override_requests (
        id, tenant_id, branch_id, productId, productName, activeContainerId, activeContainerNo,
        activeBalanceQty, stockUnit, measureUnit, capacityQty, reason, status, requestedBy, createdAt, updatedAt
      ) VALUES (
        @id, @tenant_id, @branch_id, @productId, @productName, @activeContainerId, @activeContainerNo,
        @activeBalanceQty, @stockUnit, @measureUnit, @capacityQty, @reason, 'pending', @requestedBy, @createdAt, @updatedAt
      )
    `).run({
      id,
      tenant_id: access.tenantId,
      branch_id: branchId,
      productId,
      productName: product.name || productId,
      activeContainerId: active.id,
      activeContainerNo: number(active.containerNo, 0),
      activeBalanceQty: money(active.balanceQty),
      stockUnit: units.stockUnit,
      measureUnit: units.measureUnit,
      capacityQty: units.capacityQty,
      reason,
      requestedBy: access.userId || "",
      createdAt,
      updatedAt: createdAt
    });
    const request = mapOverrideRequest(db.prepare("SELECT * FROM backbar_override_requests WHERE id = ? AND tenant_id = ?").get(id, access.tenantId));
    const alert = this.createAlert({
      access,
      branchId,
      productId,
      containerId: active.id,
      alertType: "manager_override_requested",
      severity: "high",
      title: `${product.name} next container approval needed`,
      message: `${money(active.balanceQty)} ${active.measureUnit} still left. Reason: ${reason}`,
      evidence: { requestId: id, activeContainerId: active.id, activeBalanceQty: active.balanceQty, reason }
    });
    return { request, activeContainer: mapContainer(active), alert };
  }

  decideOverrideRequest(id, payload = {}, access = {}) {
    ensureBackbarSchema();
    const request = db.prepare("SELECT * FROM backbar_override_requests WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!request) throw notFound("Override request not found");
    if (request.branch_id) assertBranch(access, request.branch_id);
    if (request.status !== "pending") throw conflict("Override request is already decided");
    const decision = String(payload.decision || payload.status || "").toLowerCase();
    const approved = decision === "approve" || decision === "approved" || payload.approved === true;
    const rejected = decision === "reject" || decision === "rejected" || payload.rejected === true;
    if (!approved && !rejected) throw conflict("Decision must be approve or reject");
    const decidedAt = now();
    const decisionNote = String(payload.decisionNote || payload.note || payload.reason || "").trim();
    if (rejected) {
      db.prepare(`
        UPDATE backbar_override_requests
        SET status = 'rejected', rejectedBy = ?, rejectedAt = ?, decisionNote = ?, updatedAt = ?
        WHERE id = ? AND tenant_id = ?
      `).run(access.userId || "", decidedAt, decisionNote, decidedAt, id, access.tenantId);
      const alert = this.createAlert({
        access,
        branchId: request.branch_id,
        productId: request.productId,
        containerId: request.activeContainerId,
        alertType: "manager_override_rejected",
        severity: "medium",
        title: `${request.productName} override rejected`,
        message: decisionNote || request.reason,
        evidence: { requestId: id, reason: request.reason, decisionNote }
      });
      return { request: mapOverrideRequest(db.prepare("SELECT * FROM backbar_override_requests WHERE id = ? AND tenant_id = ?").get(id, access.tenantId)), alert };
    }

    const result = this.overrideOpenContainer(request.productId, {
      branchId: request.branch_id,
      reason: decisionNote || request.reason,
      stockUnit: request.stockUnit,
      packUnit: request.measureUnit,
      packSize: request.capacityQty,
      requestId: id
    }, access);
    db.prepare(`
      UPDATE backbar_override_requests
      SET status = 'approved', approvedBy = ?, approvedAt = ?, decisionNote = ?, updatedAt = ?
      WHERE id = ? AND tenant_id = ?
    `).run(access.userId || "", decidedAt, decisionNote, decidedAt, id, access.tenantId);
    return {
      request: mapOverrideRequest(db.prepare("SELECT * FROM backbar_override_requests WHERE id = ? AND tenant_id = ?").get(id, access.tenantId)),
      result
    };
  }

  overrideOpenContainer(productId, payload = {}, access = {}) {
    ensureBackbarSchema();
    const branchId = payload.branchId || payload.branch_id || access.requestedBranchId || access.branchId || "";
    if (!branchId) throw conflict("branchId is required for override open");
    assertBranch(access, branchId);
    const reason = String(payload.reason || "").trim();
    if (!reason) throw conflict("Manager override reason is required");
    const product = loadProduct(productId, access, branchId);
    const units = productUnits(product, payload);
    const active = db.prepare(`
      SELECT * FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId = ? AND status = 'open' AND balanceQty > 0
      ORDER BY containerNo ASC
      LIMIT 1
    `).get(access.tenantId, branchId, productId);
    if (active) {
      db.prepare(`
        UPDATE backbar_product_containers
        SET status = 'paused_override', updatedBy = ?, updatedAt = ?
        WHERE id = ? AND tenant_id = ?
      `).run(access.userId || "", now(), active.id, access.tenantId);
      this.createAlert({
        access,
        branchId,
        productId,
        containerId: active.id,
        alertType: "manager_override_pause",
        severity: "high",
        title: `${product.name} container #${active.containerNo} paused by override`,
        message: `${money(active.balanceQty)} ${active.measureUnit} still left. Reason required before next container opened.`,
        evidence: { reason, balanceQty: active.balanceQty, measureUnit: active.measureUnit }
      });
    }
    const container = this.activeOrOpenContainer({
      access,
      branchId,
      product,
      stockUnit: units.stockUnit,
      measureUnit: units.measureUnit,
      capacityQty: units.capacityQty,
      draftId: payload.draftId || ""
    });
    const alert = this.createAlert({
      access,
      branchId,
      productId,
      containerId: container.id,
      alertType: "manager_override_open",
      severity: "high",
      title: `${product.name} ${container.stockUnit} #${container.containerNo} opened by manager override`,
      message: reason,
      evidence: { reason, previousContainerId: active?.id || "" }
    });
    return { container, alert };
  }

  draftLedger(draftId, access) {
    ensureBackbarSchema();
    const draft = loadDraft(draftId, access);
    const lines = parseLineItems(draft);
    const productIds = [...new Set(lines.map((line) => line.productId || line.product_id).filter(Boolean))];
    if (!productIds.length) {
      return { draftId, products: [], alerts: [], entries: [] };
    }
    const productSql = placeholders(productIds);
    const products = db.prepare(`SELECT * FROM products WHERE tenantId = ? AND id IN (${productSql})`).all(access.tenantId, ...productIds);
    const containers = db.prepare(`
      SELECT * FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId IN (${productSql})
      ORDER BY productId ASC, containerNo ASC
    `).all(access.tenantId, draft.branch_id || "", ...productIds).map(mapContainer);
    const entries = db.prepare(`
      SELECT * FROM backbar_product_usage_entries
      WHERE tenant_id = ? AND branch_id = ? AND productId IN (${productSql})
      ORDER BY createdAt DESC
      LIMIT 150
    `).all(access.tenantId, draft.branch_id || "", ...productIds).map(mapUsage);
    const alerts = db.prepare(`
      SELECT * FROM backbar_product_alerts
      WHERE tenant_id = ? AND branch_id = ? AND productId IN (${productSql})
      ORDER BY createdAt DESC
      LIMIT 50
    `).all(access.tenantId, draft.branch_id || "", ...productIds).map(mapAlert);
    const byProduct = new Map(products.map((product) => [product.id, product]));
    const lineByProduct = new Map(lines.map((line) => [line.productId || line.product_id, line]));

    const summaries = productIds.map((productId) => {
      const product = byProduct.get(productId) || { id: productId, name: productId };
      const line = lineByProduct.get(productId) || {};
      const { stockUnit, measureUnit, capacityQty } = productUnits(product, line);
      const productContainers = containers.filter((container) => container.productId === productId);
      const openContainers = productContainers.filter((container) => container.status === "open");
      const nonFinishedContainers = productContainers.filter((container) => container.status !== "finished");
      const productEntries = entries.filter((entry) => entry.productId === productId);
      const productAlerts = alerts.filter((alert) => alert.productId === productId);
      const sealedStock = Math.max(0, money(number(product.stock, 0) - nonFinishedContainers.length));
      const activeContainer = openContainers[0] || null;
      const computedAlerts = [];
      if (activeContainer && sealedStock > 0) {
        computedAlerts.push({
          alertType: "next_container_blocked",
          severity: "info",
          title: "Next container locked",
          message: `${product.name || productId} ${stockUnit} #${activeContainer.containerNo} must reach 0 before another ${stockUnit} opens.`
        });
      }
      return {
        productId,
        productName: product.name || productId,
        branchId: draft.branch_id || "",
        stockUnit,
        measureUnit,
        capacityQty,
        productStock: number(product.stock, 0),
        sealedStock,
        openCount: openContainers.length,
        pausedCount: productContainers.filter((container) => container.status === "paused_override").length,
        finishedCount: productContainers.filter((container) => container.status === "finished").length,
        activeContainer,
        containers: productContainers.map((container) => ({
          ...container,
          entries: productEntries.filter((entry) => entry.containerId === container.id).slice(0, 12)
        })),
        entries: productEntries,
        alerts: [...computedAlerts, ...productAlerts]
      };
    });

    return { draftId, invoiceId: draft.invoice_id || "", invoiceNumber: draft.invoice_number || "", products: summaries, alerts, entries };
  }
}

export const backbarProductConsumptionService = new BackbarProductConsumptionService();
