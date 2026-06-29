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
const PRODUCT_CONSUME_WASTAGE_WARN_PCT = 10;
const PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT = 25;
const PRODUCT_CONSUME_STAFF_WASTAGE_REPEAT_LIMIT = 3;

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
      qrCode TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT '',
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
  ensureContainerTrackingColumns();
  schemaReady = true;
}

function ensureContainerTrackingColumns() {
  const columns = db.prepare("PRAGMA table_info(backbar_product_containers)").all().map((column) => column.name);
  if (!columns.includes("qrCode")) db.prepare("ALTER TABLE backbar_product_containers ADD COLUMN qrCode TEXT DEFAULT ''").run();
  if (!columns.includes("barcode")) db.prepare("ALTER TABLE backbar_product_containers ADD COLUMN barcode TEXT DEFAULT ''").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_backbar_containers_qr ON backbar_product_containers(tenant_id, qrCode)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_backbar_containers_barcode ON backbar_product_containers(tenant_id, barcode)").run();
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
  const trackingCode = mapped.qrCode || mapped.barcode || containerTrackingCode(mapped.branchId || mapped.branch_id || "", mapped.productId || "", containerNo || 1);
  return {
    ...mapped,
    containerNo,
    containerCode: `${stockUnit} #${containerNo || 1}`,
    qrCode: trackingCode,
    barcode: mapped.barcode || trackingCode,
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

function containerTrackingCode(branchId = "", productId = "", containerNo = 0) {
  return `BB-${String(branchId || "BR").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "BR"}-${String(productId || "PRODUCT").replace(/[^a-z0-9]/gi, "").slice(0, 12) || "PRODUCT"}-${containerNo}`;
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

    lines.forEach((line, lineIndex) => {
      const productId = line.productId || line.product_id;
      if (!productId) return;
      const product = loadProduct(productId, access, draft.branch_id || draft.branchId || "");
      if (!isBackbarLine(product, line)) {
        passthroughLines.push(line);
        return;
      }
      const applied = this.applyBackbarLine({ draft, line, lineIndex, product, access, consumeStockUnit });
      allocations.push(...applied.allocations);
      alerts.push(...applied.alerts);
      stockDeductions.push(...applied.stockDeductions);
    });

    const postedLines = lines.map((line, lineIndex) => {
      const lineAllocations = allocations
        .filter((allocation) => allocation.lineIndex === lineIndex)
        .map(({ usage, ...allocation }) => allocation);
      if (!lineAllocations.length) return line;
      const stockDeductionsForLine = stockDeductions.filter((deduction) => lineAllocations.some((allocation) => allocation.containerId === deduction.containerId));
      return {
        ...line,
        backbarPosted: true,
        backbarAllocations: lineAllocations,
        backbarStockDeductions: stockDeductionsForLine.map((deduction) => ({
          containerId: deduction.containerId,
          containerNo: deduction.containerNo,
          stockUnit: deduction.stockUnit,
          quantity: deduction.quantity,
          transactionId: deduction.transactionId
        }))
      };
    });

    return { passthroughLines, allocations, alerts, stockDeductions, postedLines };
  }

  applyBackbarLine({ draft = {}, line = {}, lineIndex = 0, product = {}, access = {}, consumeStockUnit } = {}) {
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
      const balanceBefore = money(number(container.balanceQty, 0));
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

      allocations.push({
        lineIndex,
        containerId: container.id,
        containerNo: container.containerNo,
        containerCode: `${container.stockUnit || stockUnit} #${container.containerNo}`,
        productId: product.id,
        productName: product.name || product.id,
        usedQty: take,
        unit: measureUnit,
        balanceBefore,
        balanceAfter,
        stockUnit,
        stockDeducted: false,
        usage
      });

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
        const stockDeduction = {
          containerId: container.id,
          containerNo: container.containerNo,
          productId: product.id,
          stockUnit,
          quantity: 1,
          transactionId,
          deduction
        };
        stockDeductions.push(stockDeduction);
        const allocation = allocations.find((row) => row.containerId === container.id && row.usage?.id === usage.id);
        if (allocation) allocation.stockDeducted = true;
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

    const reservedContainerCount = db.prepare(`
      SELECT COUNT(*) AS count FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId = ? AND status <> 'finished'
    `).get(access.tenantId, branchId, product.id).count;
    const currentProduct = loadProduct(product.id, access, branchId);
    const sealedStock = number(currentProduct.stock, 0) - number(reservedContainerCount, 0);
    if (sealedStock <= 0) throw conflict(`${product.name} has no sealed ${stockUnit} available to open`);

    const nextNo = number(db.prepare(`
      SELECT MAX(containerNo) AS maxNo FROM backbar_product_containers
      WHERE tenant_id = ? AND branch_id = ? AND productId = ?
    `).get(access.tenantId, branchId, product.id).maxNo, 0) + 1;
    const id = makeId("bbpc");
    const createdAt = now();
    const trackingCode = containerTrackingCode(branchId, product.id, nextNo);
    db.prepare(`
      INSERT INTO backbar_product_containers (
        id, tenant_id, branch_id, productId, productName, containerNo, stockUnit, measureUnit,
        capacityQty, usedQty, balanceQty, status, qrCode, barcode, openedFromDraftId, openedAt, createdBy, updatedBy, createdAt, updatedAt
      ) VALUES (
        @id, @tenant_id, @branch_id, @productId, @productName, @containerNo, @stockUnit, @measureUnit,
        @capacityQty, 0, @capacityQty, 'open', @qrCode, @barcode, @openedFromDraftId, @openedAt, @createdBy, @updatedBy, @createdAt, @updatedAt
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
      qrCode: trackingCode,
      barcode: trackingCode,
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
    const pendingDraftFilters = draftFilters.map((filter) => filter === "status = 'confirmed'" ? "COALESCE(status, '') <> 'confirmed'" : filter);
    const pendingDraftRows = tableExists("product_consume_drafts")
      ? db.prepare(`SELECT * FROM product_consume_drafts WHERE ${pendingDraftFilters.join(" AND ")} ORDER BY updated_at DESC LIMIT @limit`).all(draftParams)
      : [];
    const pendingConsumeRows = pendingDraftRows.map((draft) => {
      const lines = parseLineItems(draft).filter((line) => {
        const lineProductId = line.productId || line.product_id || "";
        return !productId || lineProductId === productId;
      });
      const updatedAt = draft.updated_at || draft.created_at || "";
      const maxWastagePct = lines.reduce((max, line) => Math.max(max, number(line.wastagePct ?? line.wastage_pct, 0)), 0);
      const wastageApprovalLines = lines.filter((line) => number(line.wastagePct ?? line.wastage_pct, 0) > number(line.wastageApprovalPct ?? line.wastage_approval_pct, PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT));
      return {
        draftId: draft.id,
        invoiceId: draft.invoice_id || "",
        invoiceNumber: draft.invoice_number || draft.invoice_no || draft.invoice_id || "",
        status: draft.status || "draft",
        serviceId: draft.service_id || "",
        serviceName: draft.service_name || "Service",
        clientId: draft.client_id || "",
        clientName: draft.client_name || "Walk-in client",
        staffId: draft.staff_id || "",
        staffName: draft.staff_name || "Unassigned",
        lineCount: lines.length,
        maxWastagePct,
        wastageApprovalRequired: wastageApprovalLines.length > 0,
        wastageApprovalLines: wastageApprovalLines.map((line) => ({
          productId: line.productId || line.product_id || "",
          productName: line.productName || line.product_name || line.productId || line.product_id || "Product",
          wastagePct: number(line.wastagePct ?? line.wastage_pct, 0),
          wastageApprovalPct: number(line.wastageApprovalPct ?? line.wastage_approval_pct, PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT),
          wastageHitLimit: Math.max(1, Math.round(number(line.wastageHitLimit ?? line.wastage_hit_limit, PRODUCT_CONSUME_STAFF_WASTAGE_REPEAT_LIMIT)))
        })),
        expectedCost: money(lines.reduce((sum, line) => sum + number(line.expectedCost ?? line.expected_cost, 0), 0)),
        actualCost: money(lines.reduce((sum, line) => sum + number(line.actualCost ?? line.actual_cost, 0), 0)),
        ageHours: updatedAt ? Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 3600000)) : 0,
        updatedAt
      };
    }).filter((row) => row.lineCount > 0).slice(0, 80);
    const draftInvoiceIds = [...new Set(draftRows.map((draft) => draft.invoice_id).filter(Boolean))];
    const invoiceItems = tableExists("invoice_items") && draftInvoiceIds.length
      ? db.prepare(`SELECT * FROM invoice_items WHERE tenant_id = ? AND invoice_id IN (${placeholders(draftInvoiceIds)})`).all(access.tenantId, ...draftInvoiceIds)
      : [];
    const itemsByInvoice = new Map();
    for (const item of invoiceItems) {
      const rows = itemsByInvoice.get(item.invoice_id) || [];
      rows.push(item);
      itemsByInvoice.set(item.invoice_id, rows);
    }
    const varianceMap = new Map();
    const serviceMarginMap = new Map();
    for (const draft of draftRows) {
      let draftProductCost = 0;
      for (const line of parseLineItems(draft)) {
        const lineProductId = line.productId || line.product_id || "";
        if (productId && lineProductId !== productId) continue;
        draftProductCost = money(draftProductCost + number(line.actualCost ?? line.actual_cost, 0));
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
      if (draftProductCost > 0 || !productId) {
        const marginKey = draft.service_id || draft.service_name || "service";
        const serviceItems = (itemsByInvoice.get(draft.invoice_id) || []).filter((item) => item.item_type === "service");
        const matched = serviceItems.find((item) => item.item_id === draft.service_id || item.appointment_service_id === draft.service_id)
          || (serviceItems.length === 1 ? serviceItems[0] : null);
        const revenue = money(matched?.total_amount || 0);
        const row = serviceMarginMap.get(marginKey) || {
          serviceId: draft.service_id || "",
          serviceName: draft.service_name || "Service",
          invoices: 0,
          revenue: 0,
          productCost: 0,
          grossAfterProduct: 0,
          marginPct: 0,
          revenueLinked: 0,
          lastUsedAt: ""
        };
        row.invoices += 1;
        row.revenue = money(row.revenue + revenue);
        row.productCost = money(row.productCost + draftProductCost);
        row.grossAfterProduct = money(row.revenue - row.productCost);
        row.marginPct = row.revenue > 0 ? money((row.grossAfterProduct / row.revenue) * 100) : 0;
        if (revenue > 0) row.revenueLinked += 1;
        row.lastUsedAt = draft.updated_at || draft.created_at || row.lastUsedAt;
        serviceMarginMap.set(marginKey, row);
      }
    }
    const varianceRows = [...varianceMap.values()].sort((a, b) => Number(b.varianceQty || 0) - Number(a.varianceQty || 0)).slice(0, 80);
    const staffWastageRepeatMap = new Map();
    for (const draft of draftRows) {
      for (const line of parseLineItems(draft)) {
        const lineProductId = line.productId || line.product_id || "";
        if (productId && lineProductId !== productId) continue;
        const wastagePct = number(line.wastagePct ?? line.wastage_pct, 0);
        const actualQty = number(line.actualQty ?? line.actual_qty ?? line.quantity, 0);
        const expectedQty = number(line.expectedQty ?? line.expected_qty, 0);
        const maxQty = number(line.maxQty ?? line.max_qty, 0);
        const highWastage = wastagePct >= PRODUCT_CONSUME_WASTAGE_WARN_PCT;
        const highOveruse = (maxQty > 0 && actualQty > maxQty) || (expectedQty > 0 && actualQty > expectedQty * 1.15);
        if (!highWastage && !highOveruse) continue;
        const key = draft.staff_id || draft.staff_name || "unassigned";
        const row = staffWastageRepeatMap.get(key) || {
          staffId: draft.staff_id || "",
          staffName: draft.staff_name || "Unassigned",
          repeatCount: 0,
          maxWastagePct: 0,
          hitLimit: PRODUCT_CONSUME_STAFF_WASTAGE_REPEAT_LIMIT,
          products: new Set(),
          invoices: new Set(),
          cost: 0,
          lastUsedAt: ""
        };
        row.repeatCount += 1;
        row.maxWastagePct = Math.max(row.maxWastagePct, wastagePct);
        row.hitLimit = Math.min(row.hitLimit, Math.max(1, Math.round(number(line.wastageHitLimit ?? line.wastage_hit_limit, PRODUCT_CONSUME_STAFF_WASTAGE_REPEAT_LIMIT))));
        row.products.add(line.productName || line.product_name || lineProductId || "Product");
        row.invoices.add(draft.invoice_number || draft.invoice_id || "");
        row.cost = money(row.cost + number(line.actualCost ?? line.actual_cost, 0));
        row.lastUsedAt = String(draft.updated_at || draft.created_at || "").localeCompare(String(row.lastUsedAt || "")) > 0 ? (draft.updated_at || draft.created_at || "") : row.lastUsedAt;
        staffWastageRepeatMap.set(key, row);
      }
    }
    const staffWastageRepeatRows = [...staffWastageRepeatMap.values()].map((row) => ({
      ...row,
      products: [...row.products].slice(0, 5).join(", "),
      invoiceCount: row.invoices.size,
      invoices: [...row.invoices].filter(Boolean).slice(0, 5).join(", "),
      riskLevel: row.maxWastagePct > PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT || row.repeatCount >= row.hitLimit ? "high" : "medium"
    })).filter((row) => row.repeatCount >= 2 || row.maxWastagePct >= PRODUCT_CONSUME_WASTAGE_OWNER_APPROVAL_PCT)
      .sort((a, b) => Number(b.repeatCount || 0) - Number(a.repeatCount || 0) || Number(b.maxWastagePct || 0) - Number(a.maxWastagePct || 0))
      .slice(0, 80);
    const clientProfitMap = new Map();
    for (const draft of draftRows) {
      const lines = parseLineItems(draft).filter((line) => {
        const lineProductId = line.productId || line.product_id || "";
        return !productId || lineProductId === productId;
      });
      const productCost = money(lines.reduce((sum, line) => sum + number(line.actualCost ?? line.actual_cost, 0), 0));
      if (!lines.length && productId) continue;
      const serviceItems = (itemsByInvoice.get(draft.invoice_id) || []).filter((item) => item.item_type === "service");
      const matched = serviceItems.find((item) => item.item_id === draft.service_id || item.appointment_service_id === draft.service_id)
        || (serviceItems.length === 1 ? serviceItems[0] : null);
      const revenue = money(matched?.total_amount || 0);
      const key = draft.client_id || draft.client_name || draft.invoice_id || "walk-in";
      const row = clientProfitMap.get(key) || {
        clientId: draft.client_id || "",
        clientName: draft.client_name || "Walk-in client",
        invoices: 0,
        revenue: 0,
        productCost: 0,
        grossAfterProduct: 0,
        marginPct: 0,
        revenueLinked: 0,
        lastUsedAt: ""
      };
      row.invoices += 1;
      row.revenue = money(row.revenue + revenue);
      row.productCost = money(row.productCost + productCost);
      row.grossAfterProduct = money(row.revenue - row.productCost);
      row.marginPct = row.revenue > 0 ? money((row.grossAfterProduct / row.revenue) * 100) : 0;
      if (revenue > 0) row.revenueLinked += 1;
      row.lastUsedAt = draft.updated_at || draft.created_at || row.lastUsedAt;
      clientProfitMap.set(key, row);
    }
    const clientProfitRows = [...clientProfitMap.values()]
      .sort((a, b) => Number(a.marginPct || 0) - Number(b.marginPct || 0) || Number(b.productCost || 0) - Number(a.productCost || 0))
      .slice(0, 80);
    const missingAdjustmentReasonRows = groupUsageRows(
      exceptionEntries.filter((entry) => !String(entry.reason || "").trim()),
      (entry) => `${entry.productId || entry.productName || "product"}|${entry.usageType || "adjustment"}|${entry.staffId || entry.staffName || "unassigned"}`,
      (entry) => ({
        entityType: "adjustment",
        productId: entry.productId || "",
        productName: entry.productName || "Product",
        staffId: entry.staffId || "",
        staffName: entry.staffName || "Unassigned",
        usageType: entry.usageType || "manual_adjustment"
      })
    ).map((row) => ({
      ...row,
      missingReasons: row.count,
      totalLines: row.count,
      severity: row.count >= 3 || number(row.cost, 0) >= 1000 ? "high" : "medium"
    }));
    const reasonComplianceRows = [
      ...varianceRows.filter((row) => number(row.reasonCount, 0) < number(row.count, 0)).map((row) => ({
        entityType: "overuse",
        productId: row.productId || "",
        productName: row.productName || "Product",
        staffId: row.staffId || "",
        staffName: row.staffName || "Unassigned",
        serviceId: row.serviceId || "",
        serviceName: row.serviceName || "Service",
        missingReasons: Math.max(0, number(row.count, 0) - number(row.reasonCount, 0)),
        totalLines: number(row.count, 0),
        cost: row.cost || 0,
        lastUsedAt: row.lastUsedAt || "",
        severity: number(row.count, 0) - number(row.reasonCount, 0) >= 3 ? "high" : "medium"
      })),
      ...missingAdjustmentReasonRows
    ].sort((a, b) => Number(b.missingReasons || 0) - Number(a.missingReasons || 0) || Number(b.cost || 0) - Number(a.cost || 0)).slice(0, 80);
    const usageCategoryRows = groupUsageRows(entries, (entry) => entry.usageType || "client", (entry) => ({
      usageType: entry.usageType || "client",
      categoryName: entry.usageType === "client" ? "Client use" : String(entry.usageType || "manual_adjustment").replace(/_/g, " ")
    })).map((row) => ({
      ...row,
      exceptionCount: row.usageType === "client" ? 0 : row.count,
      riskLevel: row.usageType !== "client" && number(row.cost, 0) >= 1000 ? "high" : row.usageType !== "client" ? "medium" : "watch"
    })).sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0));
    const containerEfficiencyRows = containers.map((container) => {
      const containerEntries = entries.filter((entry) => entry.containerId === container.id);
      const containerClientEntries = containerEntries.filter((entry) => entry.usageType === "client");
      const containerExceptionEntries = containerEntries.filter((entry) => entry.usageType !== "client");
      const clientCost = money(containerClientEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0));
      const exceptionCost = money(containerExceptionEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0));
      const totalCost = money(clientCost + exceptionCost);
      const clientQty = money(containerClientEntries.reduce((sum, entry) => sum + number(entry.usedQty, 0), 0));
      const exceptionQty = money(containerExceptionEntries.reduce((sum, entry) => sum + number(entry.usedQty, 0), 0));
      const totalQty = money(clientQty + exceptionQty);
      const efficiencyPct = totalCost > 0 ? money((clientCost / totalCost) * 100) : totalQty > 0 ? money((clientQty / totalQty) * 100) : 0;
      return {
        productId: container.productId,
        productName: container.productName,
        containerId: container.id,
        containerNo: container.containerNo,
        status: container.status,
        measureUnit: container.measureUnit,
        clientQty,
        exceptionQty,
        balanceQty: container.balanceQty,
        clientCost,
        exceptionCost,
        efficiencyPct,
        riskLevel: exceptionCost > clientCost && totalCost > 0 ? "high" : efficiencyPct < 80 && totalQty > 0 ? "medium" : "watch",
        lastUsedAt: containerEntries[0]?.createdAt || ""
      };
    }).filter((row) => row.clientQty > 0 || row.exceptionQty > 0 || row.status !== "finished").sort((a, b) => Number(a.efficiencyPct || 0) - Number(b.efficiencyPct || 0)).slice(0, 80);
    const staffOveruseRows = groupUsageRows(varianceRows, (row) => row.staffId || row.staffName || "unassigned", (row) => ({
      staffId: row.staffId || "",
      staffName: row.staffName || "Unassigned"
    })).map((row) => {
      const staffVariance = varianceRows.filter((item) => (item.staffId || item.staffName || "unassigned") === (row.staffId || row.staffName || "unassigned"));
      return {
        ...row,
        overuseCount: staffVariance.reduce((sum, item) => sum + number(item.count, 0), 0),
        varianceQty: money(staffVariance.reduce((sum, item) => sum + number(item.varianceQty, 0), 0)),
        reasonCount: staffVariance.reduce((sum, item) => sum + number(item.reasonCount, 0), 0)
      };
    }).sort((a, b) => Number(b.overuseCount || 0) - Number(a.overuseCount || 0)).slice(0, 50);
    const serviceMarginRows = [...serviceMarginMap.values()].sort((a, b) => Number(a.marginPct || 0) - Number(b.marginPct || 0)).slice(0, 80);
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
    const batchRows = tableExists("inventory_batches") && productIds.length
      ? db.prepare(`
        SELECT * FROM inventory_batches
        WHERE tenantId = ? AND productId IN (${placeholders(productIds)})
          ${branchId ? "AND branchId = ?" : ""}
          AND quantityAvailable > 0
        ORDER BY CASE WHEN expiryDate IS NULL OR expiryDate = '' THEN 1 ELSE 0 END, expiryDate ASC
        LIMIT ${limit}
      `).all(...(branchId ? [access.tenantId, ...productIds, branchId] : [access.tenantId, ...productIds]))
      : [];
    const batchExpiryRows = batchRows.map((batch) => {
      const product = productById.get(batch.productId) || {};
      const daysToExpiry = batch.expiryDate ? Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / 86400000) : null;
      const value = money(number(batch.quantityAvailable, 0) * number(batch.unitCost || product.unitCost, 0));
      return {
        batchId: batch.id,
        batchNumber: batch.batchNumber || batch.id,
        productId: batch.productId,
        productName: product.name || batch.productId,
        branchId: batch.branchId || "",
        expiryDate: batch.expiryDate || "",
        daysToExpiry,
        quantityAvailable: money(batch.quantityAvailable),
        value,
        riskLevel: daysToExpiry !== null && daysToExpiry <= 15 ? "high" : daysToExpiry !== null && daysToExpiry <= 45 ? "medium" : "watch"
      };
    }).filter((row) => row.daysToExpiry !== null && row.daysToExpiry >= 0 && row.daysToExpiry <= 90).slice(0, 80);
    const slowMovingRows = containers
      .filter((container) => container.status !== "finished")
      .map((container) => {
        const containerEntries = entries.filter((entry) => entry.containerId === container.id);
        const lastUsedAt = containerEntries[0]?.createdAt || "";
        const idleDays = lastUsedAt ? daysOpen(lastUsedAt) : daysOpen(container.openedAt);
        const balancePct = container.capacityQty > 0 ? money((container.balanceQty / container.capacityQty) * 100) : 0;
        return {
          productId: container.productId,
          productName: container.productName,
          containerId: container.id,
          containerNo: container.containerNo,
          idleDays,
          balancePct,
          balanceQty: container.balanceQty,
          measureUnit: container.measureUnit,
          lastUsedAt,
          status: idleDays >= 14 && balancePct >= 25 ? "slow_moving" : "watch"
        };
      }).filter((row) => row.idleDays >= 7 && row.balancePct >= 10).sort((a, b) => Number(b.idleDays || 0) - Number(a.idleDays || 0)).slice(0, 80);
    const entryDates = entries.map((entry) => String(entry.createdAt || "").slice(0, 10)).filter(Boolean).sort();
    const measuredDays = Math.max(1, entryDates.length ? Math.ceil((new Date(entryDates[entryDates.length - 1]).getTime() - new Date(entryDates[0]).getTime()) / 86400000) + 1 : 1);
    const reorderRows = productRows.map((row) => {
      const product = productById.get(row.productId) || {};
      const productEntries = entries.filter((entry) => entry.productId === row.productId);
      const quantity = productEntries.reduce((sum, entry) => sum + number(entry.usedQty, 0), 0);
      const dailyUsage = money(quantity / measuredDays);
      const stock = number(product.stock, 0);
      const lowStockThreshold = number(product.lowStockThreshold || product.low_stock_threshold, 0);
      const daysToStockout = dailyUsage > 0 ? Math.floor(stock / dailyUsage) : null;
      const reorderQty = dailyUsage > 0 ? Math.max(0, Math.ceil((dailyUsage * 30) - stock)) : 0;
      return {
        productId: row.productId,
        productName: row.productName,
        dailyUsage,
        stock,
        lowStockThreshold,
        daysToStockout,
        reorderQty,
        riskLevel: daysToStockout !== null && daysToStockout <= 7 ? "high" : daysToStockout !== null && daysToStockout <= 21 ? "medium" : stock <= lowStockThreshold ? "medium" : "watch"
      };
    }).filter((row) => row.reorderQty > 0 || row.riskLevel !== "watch").sort((a, b) => number(a.daysToStockout, 9999) - number(b.daysToStockout, 9999)).slice(0, 80);
    const productControlScoreRows = productRows.map((row) => {
      const leakage = leakageRows.find((item) => item.productId === row.productId);
      const varianceCount = varianceRows.filter((item) => item.productId === row.productId).reduce((sum, item) => sum + number(item.count, 0), 0);
      const riskContainers = containerRiskRows.filter((item) => item.productId === row.productId).length;
      const expiringBatches = batchExpiryRows.filter((item) => item.productId === row.productId).length;
      const reorder = reorderRows.find((item) => item.productId === row.productId);
      const slowContainers = slowMovingRows.filter((item) => item.productId === row.productId).length;
      const penalties = Math.min(45, number(leakage?.riskScore, 0))
        + Math.min(20, varianceCount * 4)
        + Math.min(15, riskContainers * 5)
        + Math.min(10, expiringBatches * 5)
        + (reorder ? 10 : 0)
        + Math.min(10, slowContainers * 3);
      const score = Math.max(0, Math.round(100 - penalties));
      const reasons = [
        leakage ? "leakage" : "",
        varianceCount ? `${varianceCount} overuse` : "",
        riskContainers ? `${riskContainers} container risk` : "",
        expiringBatches ? `${expiringBatches} expiry batch` : "",
        reorder ? "reorder" : "",
        slowContainers ? `${slowContainers} slow container` : ""
      ].filter(Boolean);
      return {
        productId: row.productId,
        productName: row.productName,
        score,
        riskLevel: score < 60 ? "high" : score < 80 ? "medium" : "watch",
        leakageScore: number(leakage?.riskScore, 0),
        varianceCount,
        riskContainers,
        expiringBatches,
        slowContainers,
        reorderQty: reorder?.reorderQty || 0,
        reasonText: reasons.join(", ") || "clean"
      };
    }).sort((a, b) => Number(a.score || 0) - Number(b.score || 0)).slice(0, 80);
    const usageDayMap = new Map();
    const usageWeekMap = new Map();
    const weekStart = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const offset = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - offset);
      return date.toISOString().slice(0, 10);
    };
    for (const entry of entries) {
      const day = String(entry.createdAt || "").slice(0, 10) || "undated";
      const week = weekStart(entry.createdAt || day) || day;
      for (const [key, map] of [[day, usageDayMap], [week, usageWeekMap]]) {
        const row = map.get(key) || {
          period: key,
          entries: 0,
          clientEntries: 0,
          exceptionEntries: 0,
          usageCost: 0,
          exceptionCost: 0,
          usedQty: 0,
          unit: entry.unit || ""
        };
        row.entries += 1;
        row.usedQty = money(row.usedQty + number(entry.usedQty, 0));
        row.usageCost = money(row.usageCost + number(entry.productCost, 0));
        if (entry.usageType === "client") {
          row.clientEntries += 1;
        } else {
          row.exceptionEntries += 1;
          row.exceptionCost = money(row.exceptionCost + number(entry.productCost, 0));
        }
        map.set(key, row);
      }
    }
    const dailyTrendRows = [...usageDayMap.values()].sort((a, b) => String(b.period).localeCompare(String(a.period))).slice(0, 30);
    const weeklyTrendRows = [...usageWeekMap.values()].sort((a, b) => String(b.period).localeCompare(String(a.period))).slice(0, 16);
    const approvalSlaRows = approvalRows.map((request) => {
      const createdAt = request.createdAt || "";
      const updatedAt = request.updatedAt || "";
      const endMs = request.status === "pending" ? Date.now() : new Date(updatedAt || createdAt).getTime();
      const startMs = new Date(createdAt).getTime();
      const ageHours = createdAt && !Number.isNaN(startMs) ? Math.max(0, Math.round((endMs - startMs) / 3600000)) : 0;
      return {
        approvalId: request.id,
        productId: request.productId || "",
        productName: request.productName || "Product",
        staffId: request.staffId || "",
        staffName: request.staffName || "Unassigned",
        status: request.status || "pending",
        ageHours,
        slaStatus: request.status === "pending" && ageHours >= 24 ? "breached" : ageHours >= 12 ? "watch" : "ok",
        reason: request.reason || "",
        createdAt,
        updatedAt
      };
    }).sort((a, b) => Number(b.ageHours || 0) - Number(a.ageHours || 0)).slice(0, 80);
    const staffProductRiskMap = new Map();
    for (const entry of entries) {
      const key = `${entry.staffId || entry.staffName || "unassigned"}|${entry.productId || entry.productName || "product"}`;
      const row = staffProductRiskMap.get(key) || {
        staffId: entry.staffId || "",
        staffName: entry.staffName || "Unassigned",
        productId: entry.productId || "",
        productName: entry.productName || "Product",
        entries: 0,
        exceptionEntries: 0,
        usageCost: 0,
        exceptionCost: 0,
        lastUsedAt: ""
      };
      row.entries += 1;
      row.usageCost = money(row.usageCost + number(entry.productCost, 0));
      if (entry.usageType !== "client") {
        row.exceptionEntries += 1;
        row.exceptionCost = money(row.exceptionCost + number(entry.productCost, 0));
      }
      row.lastUsedAt = String(entry.createdAt || "").localeCompare(String(row.lastUsedAt || "")) > 0 ? entry.createdAt : row.lastUsedAt;
      staffProductRiskMap.set(key, row);
    }
    const staffProductRiskRows = [...staffProductRiskMap.values()].map((row) => {
      const overuseCount = varianceRows
        .filter((item) => (item.staffId || item.staffName || "unassigned") === (row.staffId || row.staffName || "unassigned") && item.productId === row.productId)
        .reduce((sum, item) => sum + number(item.count, 0), 0);
      const exceptionRatio = row.usageCost > 0 ? money((row.exceptionCost / row.usageCost) * 100) : 0;
      const riskScore = Math.min(100, Math.round(exceptionRatio + overuseCount * 12 + row.exceptionEntries * 4));
      return {
        ...row,
        overuseCount,
        exceptionRatio,
        riskScore,
        riskLevel: riskScore >= 60 ? "high" : riskScore >= 25 ? "medium" : "watch"
      };
    }).filter((row) => row.riskScore > 0).sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0)).slice(0, 80);
    const riskRank = { high: 3, medium: 2, watch: 1 };
    const stockReconciliationRows = productRows.map((row) => {
      const product = productById.get(row.productId) || {};
      const productContainers = containers.filter((container) => container.productId === row.productId);
      const openBalanceQty = money(productContainers.filter((container) => container.status !== "finished").reduce((sum, container) => sum + number(container.balanceQty, 0), 0));
      const openCapacityQty = money(productContainers.filter((container) => container.status !== "finished").reduce((sum, container) => sum + number(container.capacityQty, 0), 0));
      const sealedStock = number(product.stock, 0);
      const lowStockThreshold = number(product.lowStockThreshold || product.low_stock_threshold, 0);
      const exceptionCost = money(exceptionEntries.filter((entry) => entry.productId === row.productId).reduce((sum, entry) => sum + number(entry.productCost, 0), 0));
      const issue = sealedStock <= lowStockThreshold ? "low sealed stock" : exceptionCost > 0 ? "exception usage" : openBalanceQty > openCapacityQty ? "open balance mismatch" : "ok";
      return {
        productId: row.productId,
        productName: row.productName,
        sealedStock,
        lowStockThreshold,
        openContainers: productContainers.filter((container) => container.status !== "finished").length,
        openBalanceQty,
        openCapacityQty,
        measureUnit: productContainers[0]?.measureUnit || "",
        consumedText: row.totalUsedText || "0",
        exceptionCost,
        issue,
        riskLevel: issue === "ok" ? "watch" : sealedStock <= lowStockThreshold || exceptionCost >= 1000 ? "high" : "medium"
      };
    }).filter((row) => row.issue !== "ok" || row.openContainers > 0).sort((a, b) => number(riskRank[b.riskLevel], 0) - number(riskRank[a.riskLevel], 0) || Number(b.exceptionCost || 0) - Number(a.exceptionCost || 0)).slice(0, 80);
    const containerLifecycleRows = containers.map((container) => {
      const containerEntries = entries.filter((entry) => entry.containerId === container.id);
      const clientEntryCount = containerEntries.filter((entry) => entry.usageType === "client").length;
      const exceptionEntryCount = containerEntries.length - clientEntryCount;
      const usedPct = container.capacityQty > 0 ? money(((container.capacityQty - container.balanceQty) / container.capacityQty) * 100) : 0;
      const lastUsedAt = containerEntries[0]?.createdAt || "";
      return {
        productId: container.productId,
        productName: container.productName,
        containerId: container.id,
        containerNo: container.containerNo,
        status: container.status,
        openDays: daysOpen(container.openedAt),
        usedPct,
        balanceQty: container.balanceQty,
        measureUnit: container.measureUnit,
        clientEntryCount,
        exceptionEntryCount,
        lastUsedAt,
        riskLevel: container.status !== "finished" && daysOpen(container.openedAt) >= 21 ? "high" : exceptionEntryCount > 0 ? "medium" : "watch"
      };
    }).sort((a, b) => Number(b.openDays || 0) - Number(a.openDays || 0)).slice(0, 80);
    const serviceRecipeComplianceMap = new Map();
    for (const draft of draftRows) {
      const key = draft.service_id || draft.service_name || "service";
      const row = serviceRecipeComplianceMap.get(key) || {
        serviceId: draft.service_id || "",
        serviceName: draft.service_name || "Service",
        invoices: new Set(),
        recipeLines: 0,
        overuseLines: 0,
        missingRecipeLines: 0,
        expectedQty: 0,
        actualQty: 0,
        varianceQty: 0,
        cost: 0,
        lastUsedAt: ""
      };
      row.invoices.add(draft.invoice_id || draft.id);
      for (const line of parseLineItems(draft)) {
        const lineProductId = line.productId || line.product_id || "";
        if (productId && lineProductId !== productId) continue;
        const expectedQty = number(line.expectedQty ?? line.expected_qty, 0);
        const actualQty = number(line.actualQty ?? line.actual_qty, 0);
        const maxQty = number(line.maxQty ?? line.max_qty, 0);
        if (expectedQty <= 0 && maxQty <= 0) row.missingRecipeLines += 1;
        row.recipeLines += 1;
        row.expectedQty = money(row.expectedQty + expectedQty);
        row.actualQty = money(row.actualQty + actualQty);
        row.cost = money(row.cost + number(line.actualCost ?? line.actual_cost, 0));
        if ((maxQty > 0 && actualQty > maxQty) || (expectedQty > 0 && actualQty > expectedQty * 1.15)) row.overuseLines += 1;
      }
      row.varianceQty = money(row.actualQty - row.expectedQty);
      row.lastUsedAt = draft.updated_at || draft.created_at || row.lastUsedAt;
      serviceRecipeComplianceMap.set(key, row);
    }
    const serviceRecipeComplianceRows = [...serviceRecipeComplianceMap.values()].map((row) => {
      const compliantLines = Math.max(0, row.recipeLines - row.overuseLines - row.missingRecipeLines);
      const compliancePct = row.recipeLines > 0 ? money((compliantLines / row.recipeLines) * 100) : 0;
      return {
        ...row,
        invoiceCount: row.invoices.size,
        invoices: undefined,
        compliancePct,
        riskLevel: compliancePct < 70 ? "high" : compliancePct < 90 ? "medium" : "watch"
      };
    }).filter((row) => row.recipeLines > 0).sort((a, b) => Number(a.compliancePct || 0) - Number(b.compliancePct || 0)).slice(0, 80);
    const productDailyUsageMap = new Map(productRows.map((row) => {
      const productEntries = entries.filter((entry) => entry.productId === row.productId);
      const usedQty = productEntries.reduce((sum, entry) => sum + number(entry.usedQty, 0), 0);
      const usageCost = productEntries.reduce((sum, entry) => sum + number(entry.productCost, 0), 0);
      return [row.productId, {
        dailyQty: money(usedQty / measuredDays),
        dailyCost: money(usageCost / measuredDays),
        unit: productEntries[0]?.unit || ""
      }];
    }));
    const forecastBurnRows = productRows.map((row) => {
      const velocity = productDailyUsageMap.get(row.productId) || {};
      const product = productById.get(row.productId) || {};
      const productContainers = containers.filter((container) => container.productId === row.productId && container.status !== "finished");
      const openBalanceQty = money(productContainers.reduce((sum, container) => sum + number(container.balanceQty, 0), 0));
      const sealedStock = number(product.stock, 0);
      const forecast7Cost = money(number(velocity.dailyCost, 0) * 7);
      const forecast30Cost = money(number(velocity.dailyCost, 0) * 30);
      const daysOpenBalance = number(velocity.dailyQty, 0) > 0 ? Math.floor(openBalanceQty / number(velocity.dailyQty, 0)) : null;
      return {
        productId: row.productId,
        productName: row.productName,
        dailyQty: velocity.dailyQty || 0,
        dailyCost: velocity.dailyCost || 0,
        unit: velocity.unit || "",
        openBalanceQty,
        sealedStock,
        forecast7Cost,
        forecast30Cost,
        daysOpenBalance,
        riskLevel: daysOpenBalance !== null && daysOpenBalance <= 3 ? "high" : daysOpenBalance !== null && daysOpenBalance <= 10 ? "medium" : "watch"
      };
    }).filter((row) => row.dailyQty > 0 || row.forecast30Cost > 0).sort((a, b) => Number(b.forecast30Cost || 0) - Number(a.forecast30Cost || 0)).slice(0, 80);
    const averageDailyCost = dailyTrendRows.length ? dailyTrendRows.reduce((sum, row) => sum + number(row.usageCost, 0), 0) / dailyTrendRows.length : 0;
    const usageAnomalyRows = dailyTrendRows.map((row) => {
      const spikePct = averageDailyCost > 0 ? money(((number(row.usageCost, 0) - averageDailyCost) / averageDailyCost) * 100) : 0;
      const exceptionRatio = number(row.usageCost, 0) > 0 ? money((number(row.exceptionCost, 0) / number(row.usageCost, 0)) * 100) : 0;
      return {
        period: row.period,
        entries: row.entries,
        usageCost: row.usageCost,
        exceptionCost: row.exceptionCost,
        spikePct,
        exceptionRatio,
        riskLevel: spikePct >= 75 || exceptionRatio >= 25 ? "high" : spikePct >= 35 || exceptionRatio > 0 ? "medium" : "watch"
      };
    }).filter((row) => row.riskLevel !== "watch").sort((a, b) => Number(b.spikePct || 0) - Number(a.spikePct || 0) || Number(b.exceptionRatio || 0) - Number(a.exceptionRatio || 0)).slice(0, 80);
    const expiryPriorityRows = batchExpiryRows.map((batch) => {
      const velocity = productDailyUsageMap.get(batch.productId) || {};
      const daysToUseAtVelocity = number(velocity.dailyQty, 0) > 0 ? Math.ceil(number(batch.quantityAvailable, 0) / number(velocity.dailyQty, 0)) : null;
      const expiryGapDays = daysToUseAtVelocity !== null && batch.daysToExpiry !== null ? number(batch.daysToExpiry, 0) - daysToUseAtVelocity : null;
      return {
        ...batch,
        dailyQty: velocity.dailyQty || 0,
        unit: velocity.unit || "",
        daysToUseAtVelocity,
        expiryGapDays,
        riskLevel: expiryGapDays !== null && expiryGapDays < 0 ? "high" : expiryGapDays !== null && expiryGapDays <= 10 ? "medium" : batch.riskLevel || "watch"
      };
    }).sort((a, b) => number(a.expiryGapDays, 9999) - number(b.expiryGapDays, 9999)).slice(0, 80);
    const costDriftRows = productRows.map((row) => {
      const costs = entries
        .filter((entry) => entry.productId === row.productId && number(entry.usedQty, 0) > 0 && number(entry.productCost, 0) > 0)
        .map((entry) => money(number(entry.productCost, 0) / number(entry.usedQty, 1)));
      if (!costs.length) return null;
      const minUnitCost = Math.min(...costs);
      const maxUnitCost = Math.max(...costs);
      const avgUnitCost = money(costs.reduce((sum, cost) => sum + cost, 0) / costs.length);
      const driftPct = minUnitCost > 0 ? money(((maxUnitCost - minUnitCost) / minUnitCost) * 100) : 0;
      return {
        productId: row.productId,
        productName: row.productName,
        samples: costs.length,
        minUnitCost,
        maxUnitCost,
        avgUnitCost,
        driftPct,
        riskLevel: driftPct >= 30 ? "high" : driftPct >= 10 ? "medium" : "watch"
      };
    }).filter(Boolean).filter((row) => row.riskLevel !== "watch").sort((a, b) => Number(b.driftPct || 0) - Number(a.driftPct || 0)).slice(0, 80);
    const clientRepeatUsageRows = groupUsageRows(clientEntries, (entry) => `${entry.clientId || entry.clientName || "walk-in"}|${entry.serviceId || entry.serviceName || "service"}|${entry.productId || entry.productName || "product"}`, (entry) => ({
      clientId: entry.clientId || "",
      clientName: entry.clientName || "Walk-in client",
      serviceId: entry.serviceId || "",
      serviceName: entry.serviceName || "Service",
      productId: entry.productId || "",
      productName: entry.productName || "Product"
    })).map((row) => ({
      ...row,
      avgCost: row.count > 0 ? money(number(row.cost, 0) / number(row.count, 1)) : 0,
      riskLevel: row.count >= 3 && number(row.cost, 0) >= 1000 ? "high" : row.count >= 2 ? "medium" : "watch"
    })).filter((row) => row.count >= 2).sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0)).slice(0, 80);
    const adjustmentReasonHeatRows = groupUsageRows(exceptionEntries, (entry) => `${entry.usageType || "manual_adjustment"}|${entry.reason || "No reason"}`, (entry) => ({
      usageType: entry.usageType || "manual_adjustment",
      reason: entry.reason || "No reason"
    })).map((row) => ({
      ...row,
      riskLevel: row.reason === "No reason" || number(row.cost, 0) >= 1000 || number(row.count, 0) >= 3 ? "high" : "medium"
    })).sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0) || Number(b.count || 0) - Number(a.count || 0)).slice(0, 80);
    const managerActionRows = [
      ...pendingConsumeRows.filter((row) => row.wastageApprovalRequired).map((row) => ({
        actionType: "wastage_owner_approval",
        title: `Approve wastage ${row.invoiceNumber || row.draftId}`,
        detail: `${row.staffName || "Staff"} · max waste ${row.maxWastagePct || 0}% · ${row.lineCount || 0} lines`,
        riskLevel: "high",
        actionAt: row.updatedAt || ""
      })),
      ...pendingConsumeRows.filter((row) => number(row.ageHours, 0) >= 24).map((row) => ({
        actionType: "pending_consume",
        title: `Confirm consume ${row.invoiceNumber || row.draftId}`,
        detail: `${row.clientName || "Client"} · ${row.lineCount || 0} lines · ${row.ageHours || 0}h pending`,
        riskLevel: "high",
        actionAt: row.updatedAt || ""
      })),
      ...staffWastageRepeatRows.filter((row) => row.riskLevel === "high").slice(0, 8).map((row) => ({
        actionType: "staff_wastage_repeat",
        title: `Review ${row.staffName || "Staff"} wastage`,
        detail: `${row.repeatCount || 0}/${row.hitLimit || PRODUCT_CONSUME_STAFF_WASTAGE_REPEAT_LIMIT} hits · max ${row.maxWastagePct || 0}% · ${row.products || "products"}`,
        riskLevel: "high",
        actionAt: row.lastUsedAt || ""
      })),
      ...approvalSlaRows.filter((row) => row.slaStatus === "breached").map((row) => ({
        actionType: "approval_sla",
        title: `Review override ${row.productName}`,
        detail: `${row.staffName || "Staff"} · ${row.ageHours || 0}h · ${row.reason || "No reason"}`,
        riskLevel: "high",
        actionAt: row.createdAt || ""
      })),
      ...usageAnomalyRows.slice(0, 8).map((row) => ({
        actionType: "usage_anomaly",
        title: `Check usage spike ${row.period}`,
        detail: `${row.spikePct || 0}% spike · waste ${row.exceptionRatio || 0}%`,
        riskLevel: row.riskLevel,
        actionAt: row.period
      })),
      ...expiryPriorityRows.filter((row) => row.riskLevel === "high").slice(0, 8).map((row) => ({
        actionType: "expiry_priority",
        title: `Use expiring batch ${row.productName}`,
        detail: `${row.batchNumber || "batch"} · ${row.daysToExpiry || 0} days expiry · velocity ${row.dailyQty || 0}/day`,
        riskLevel: "high",
        actionAt: row.expiryDate || ""
      })),
      ...productControlScoreRows.filter((row) => row.riskLevel === "high").slice(0, 8).map((row) => ({
        actionType: "control_score",
        title: `Audit product ${row.productName}`,
        detail: `Score ${row.score || 0} · ${row.reasonText || "risk"}`,
        riskLevel: "high",
        actionAt: ""
      })),
      ...reasonComplianceRows.filter((row) => row.severity === "high").slice(0, 8).map((row) => ({
        actionType: "reason_compliance",
        title: `Fix reason gaps ${row.productName}`,
        detail: `${row.staffName || "Staff"} · ${row.missingReasons || 0} missing`,
        riskLevel: "high",
        actionAt: row.lastUsedAt || ""
      }))
    ].sort((a, b) => number(riskRank[b.riskLevel], 0) - number(riskRank[a.riskLevel], 0) || String(b.actionAt || "").localeCompare(String(a.actionAt || ""))).slice(0, 80);
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
        approvalHistory: approvalRows.length,
        batchesNearExpiry: batchExpiryRows.length,
        staffOveruse: staffOveruseRows.length,
        lowMarginServices: serviceMarginRows.filter((row) => number(row.marginPct, 0) < 50 || number(row.grossAfterProduct, 0) < 0).length,
        slowMovingContainers: slowMovingRows.length,
        reorderSignals: reorderRows.length,
        pendingConsumes: pendingConsumeRows.length,
        reasonComplianceIssues: reasonComplianceRows.length,
        usageCategories: usageCategoryRows.length,
        containerEfficiencyRows: containerEfficiencyRows.length,
        clientProfitRows: clientProfitRows.length,
        productControlScores: productControlScoreRows.length,
        dailyTrendRows: dailyTrendRows.length,
        weeklyTrendRows: weeklyTrendRows.length,
        approvalSlaBreaches: approvalSlaRows.filter((row) => row.slaStatus === "breached").length,
        staffProductRisks: staffProductRiskRows.length,
        stockReconciliationRows: stockReconciliationRows.length,
        containerLifecycleRows: containerLifecycleRows.length,
        serviceRecipeComplianceRows: serviceRecipeComplianceRows.length,
        forecastBurnRows: forecastBurnRows.length,
        usageAnomalies: usageAnomalyRows.length,
        expiryPriorityRows: expiryPriorityRows.length,
        costDriftRows: costDriftRows.length,
        clientRepeatUsageRows: clientRepeatUsageRows.length,
        adjustmentReasonHeatRows: adjustmentReasonHeatRows.length,
        staffWastageRepeats: staffWastageRepeatRows.filter((row) => row.riskLevel === "high").length,
        managerActions: managerActionRows.length
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
      batchExpiryRows,
      staffOveruseRows,
      serviceMarginRows,
      slowMovingRows,
      reorderRows,
      pendingConsumeRows,
      reasonComplianceRows,
      usageCategoryRows,
      containerEfficiencyRows,
      clientProfitRows,
      productControlScoreRows,
      dailyTrendRows,
      weeklyTrendRows,
      approvalSlaRows,
      staffProductRiskRows,
      stockReconciliationRows,
      containerLifecycleRows,
      serviceRecipeComplianceRows,
      forecastBurnRows,
      usageAnomalyRows,
      expiryPriorityRows,
      costDriftRows,
      clientRepeatUsageRows,
      adjustmentReasonHeatRows,
      staffWastageRepeatRows,
      managerActionRows,
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
    const expiringContainers = containers
      .filter((container) => container.status !== "finished")
      .map((container) => {
        const productExpiry = product.expiryDate || product.expiry_date || product.expiry || product.expiresAt || product.expires_at || "";
        const expiryDays = productExpiry ? Math.ceil((new Date(productExpiry).getTime() - Date.now()) / 86400000) : null;
        return {
          ...container,
          expiryDate: productExpiry,
          expiryDays,
          riskLevel: expiryDays !== null && expiryDays <= 15 ? "high" : expiryDays !== null && expiryDays <= 45 ? "medium" : daysOpen(container.openedAt) >= 21 ? "medium" : "watch"
        };
      })
      .filter((container) => container.expiryDays !== null || container.riskLevel !== "watch");
    const actionQueue = [
      ...approvals.filter((request) => request.status === "pending").map((request) => ({
        actionType: "approval",
        title: `Approve/reject ${request.productName || product.name}`,
        detail: `${request.activeBalanceQty} ${request.measureUnit} left in #${request.activeContainerNo}`,
        riskLevel: "high",
        actionAt: request.createdAt || ""
      })),
      ...alerts.filter((alert) => alert.status === "open").map((alert) => ({
        actionType: "alert",
        title: alert.title || alert.alertType,
        detail: alert.message || "",
        riskLevel: alert.severity || "medium",
        actionAt: alert.createdAt || ""
      })),
      ...containers.filter((container) => container.status === "open" && daysOpen(container.openedAt) >= 21).map((container) => ({
        actionType: "open_age",
        title: `${container.containerCode} open too long`,
        detail: `${daysOpen(container.openedAt)} days open · ${container.balanceQty} ${container.measureUnit} left`,
        riskLevel: "medium",
        actionAt: container.openedAt || ""
      }))
    ].sort((a, b) => String(b.actionAt || "").localeCompare(String(a.actionAt || ""))).slice(0, 40);
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
      product: {
        id: product.id || productId,
        name: product.name || productId,
        brand: product.brand || product.brandName || "",
        category: product.category || "",
        stock: number(product.stock, 0),
        unit: product.unit || "pcs"
      },
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
      profitSummary: {
        serviceRevenue: totalRevenue,
        productCost: totalProductCost,
        wastageCost: totalWastageCost,
        actualProfit: money(totalRevenue - totalProductCost),
        profitMarginPct: totalRevenue > 0 ? money(((totalRevenue - totalProductCost) / totalRevenue) * 100) : 0
      },
      containers: containers.map((container) => ({
        ...container,
        entries: entries.filter((entry) => entry.containerId === container.id)
      })),
      openContainers: containers.filter((container) => container.status === "open"),
      finishedContainers: containers.filter((container) => container.status === "finished"),
      expiringContainers,
      actionQueue,
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

  scanContainer(query = {}, access = {}) {
    ensureBackbarSchema();
    const rawCode = String(query.code || query.qrCode || query.qr_code || query.barcode || query.id || "").trim();
    if (!rawCode) throw conflict("Container QR/barcode is required");
    const branchId = query.branchId || query.branch_id || access.requestedBranchId || access.branchId || "";
    if (branchId) assertBranch(access, branchId);
    const params = { tenant_id: access.tenantId, code: rawCode };
    const filters = ["tenant_id = @tenant_id", "(id = @code OR qrCode = @code OR barcode = @code)"];
    if (branchId) {
      filters.push("branch_id = @branch_id");
      params.branch_id = branchId;
    }
    let container = db.prepare(`
      SELECT * FROM backbar_product_containers
      WHERE ${filters.join(" AND ")}
      LIMIT 1
    `).get(params);
    if (!container && rawCode.toUpperCase().startsWith("BB-")) {
      const parts = rawCode.split("-");
      const containerNo = number(parts[parts.length - 1], 0);
      const productPart = parts.length >= 4 ? parts[parts.length - 2] : "";
      if (containerNo > 0 && productPart) {
        container = db.prepare(`
          SELECT * FROM backbar_product_containers
          WHERE tenant_id = @tenant_id
            ${branchId ? "AND branch_id = @branch_id" : ""}
            AND containerNo = @containerNo
            AND replace(productId, '-', '') LIKE @productLike
          ORDER BY updatedAt DESC
          LIMIT 1
        `).get({ ...params, containerNo, productLike: `%${productPart}%` });
      }
    }
    if (!container) throw notFound("Backbar container not found for this QR/barcode");
    if (container.branch_id) assertBranch(access, container.branch_id);
    const mapped = mapContainer(container);
    const product = db.prepare("SELECT * FROM products WHERE id = ? AND tenantId = ?").get(container.productId, access.tenantId) || {};
    const entries = db.prepare(`
      SELECT * FROM backbar_product_usage_entries
      WHERE tenant_id = ? AND containerId = ?
      ORDER BY createdAt DESC
      LIMIT 100
    `).all(access.tenantId, container.id).map(mapUsage);
    const alerts = db.prepare(`
      SELECT * FROM backbar_product_alerts
      WHERE tenant_id = ? AND containerId = ?
      ORDER BY createdAt DESC
      LIMIT 50
    `).all(access.tenantId, container.id).map(mapAlert);
    const approvals = db.prepare(`
      SELECT * FROM backbar_override_requests
      WHERE tenant_id = ? AND activeContainerId = ?
      ORDER BY createdAt DESC
      LIMIT 20
    `).all(access.tenantId, container.id).map(mapOverrideRequest);
    return {
      code: rawCode,
      product: {
        id: product.id || container.productId,
        name: product.name || container.productName,
        stock: number(product.stock, 0),
        unit: product.unit || container.stockUnit
      },
      container: mapped,
      summary: {
        usedText: `${mapped.usedQty} ${mapped.measureUnit}`,
        balanceText: `${mapped.balanceQty} ${mapped.measureUnit}`,
        entries: entries.length,
        alerts: alerts.filter((alert) => alert.status === "open").length,
        approvals: approvals.length,
        status: mapped.status
      },
      entries,
      alerts,
      approvals
    };
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
      requestId: id,
      approvalDecision: true
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
    const requestId = payload.requestId || payload.request_id || "";
    if (!payload.approvalDecision) {
      throw conflict("Manager approval request is required before opening the next container");
    }
    const approvalRequest = requestId
      ? db.prepare(`
        SELECT * FROM backbar_override_requests
        WHERE id = ? AND tenant_id = ? AND branch_id = ? AND productId = ?
        LIMIT 1
      `).get(requestId, access.tenantId, branchId, productId)
      : null;
    if (!approvalRequest) throw conflict("Approved override request was not found");
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
