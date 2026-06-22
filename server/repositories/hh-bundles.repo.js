import { db } from "../db.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS hhBundles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    happyHourId INTEGER REFERENCES happyHours(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bundlePricePaise INTEGER,
    percentOff INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS hhBundleServices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bundleId INTEGER NOT NULL REFERENCES hhBundles(id) ON DELETE CASCADE,
    serviceId TEXT NOT NULL,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hhBundles ON hhBundles(tenantId, branchId, status);
  CREATE INDEX IF NOT EXISTS idx_hhBundleSvcs ON hhBundleServices(bundleId, tenantId, branchId);
`);

const statements = {
  createBundle: db.prepare(`
    INSERT INTO hhBundles (tenantId, branchId, happyHourId, name, bundlePricePaise, percentOff, status)
    VALUES (@tenantId, @branchId, @happyHourId, @name, @bundlePricePaise, @percentOff, @status)
  `),
  insertService: db.prepare(`
    INSERT INTO hhBundleServices (bundleId, serviceId, tenantId, branchId)
    VALUES (@bundleId, @serviceId, @tenantId, @branchId)
  `),
  listBundles: db.prepare(`
    SELECT * FROM hhBundles
    WHERE tenantId = @tenantId AND branchId = @branchId AND status = 'active'
    ORDER BY createdAt DESC
  `),
  servicesByBundle: db.prepare(`
    SELECT * FROM hhBundleServices
    WHERE bundleId = @bundleId AND tenantId = @tenantId AND branchId = @branchId
    ORDER BY id ASC
  `),
  removeBundle: db.prepare(`
    UPDATE hhBundles
    SET status = 'inactive', updatedAt = strftime('%s','now')
    WHERE id = @id AND tenantId = @tenantId AND branchId = @branchId
  `)
};

function attachServices(bundle) {
  return {
    ...bundle,
    services: statements.servicesByBundle.all({
      bundleId: bundle.id,
      tenantId: bundle.tenantId,
      branchId: bundle.branchId
    })
  };
}

const createBundleTx = db.transaction((data) => {
  const payload = {
    tenantId: data.tenantId,
    branchId: data.branchId,
    happyHourId: data.happyHourId ? Number.parseInt(data.happyHourId, 10) : null,
    name: String(data.name || "").trim(),
    bundlePricePaise: data.bundlePricePaise === null || data.bundlePricePaise === undefined || data.bundlePricePaise === ""
      ? null
      : Math.max(0, Number.parseInt(data.bundlePricePaise, 10) || 0),
    percentOff: data.percentOff === null || data.percentOff === undefined || data.percentOff === ""
      ? null
      : Math.min(100, Math.max(0, Number.parseInt(data.percentOff, 10) || 0)),
    status: data.status === "inactive" ? "inactive" : "active"
  };
  const result = statements.createBundle.run(payload);
  const bundleId = Number(result.lastInsertRowid);
  for (const rawId of data.serviceIds || []) {
    const serviceId = String(rawId || "").trim();
    if (serviceId) statements.insertService.run({ bundleId, serviceId, tenantId: payload.tenantId, branchId: payload.branchId });
  }
  return attachServices({ ...payload, id: bundleId });
});

export function createBundle(data = {}) {
  return createBundleTx(data);
}

export function listBundles(scope = {}) {
  return statements.listBundles.all(scope).map(attachServices);
}

export function getActiveHHBundles(scope = {}) {
  const activeHappyHourIds = new Set(happyHoursEngine.getActiveHappyHours(scope).map((hh) => Number(hh.id)));
  return listBundles(scope).filter((bundle) => !bundle.happyHourId || activeHappyHourIds.has(Number(bundle.happyHourId)));
}

export function matchBundle({ tenantId, branchId, serviceIds = [], items = [] } = {}) {
  const cartIds = new Set((serviceIds || []).map((id) => String(id)));
  const priceByServiceId = new Map((items || []).map((item) => [String(item.serviceId), Number(item.pricePaise || 0) * Math.max(1, Number(item.qty || 1))]));
  let best = null;
  for (const bundle of getActiveHHBundles({ tenantId, branchId })) {
    const bundleServiceIds = (bundle.services || []).map((service) => String(service.serviceId));
    if (!bundleServiceIds.length || !bundleServiceIds.every((id) => cartIds.has(id))) continue;
    const regularPricePaise = bundleServiceIds.reduce((sum, id) => sum + Number(priceByServiceId.get(id) || 0), 0);
    if (!regularPricePaise) continue;
    const bundlePricePaise = bundle.bundlePricePaise ?? Math.max(0, regularPricePaise - Math.floor(regularPricePaise * Number(bundle.percentOff || 0) / 100));
    const savingsPaise = Math.max(0, regularPricePaise - bundlePricePaise);
    if (savingsPaise && (!best || savingsPaise > best.bundleSavingsPaise)) {
      best = {
        bundleId: bundle.id,
        bundleName: bundle.name,
        bundleSavingsPaise: savingsPaise,
        bundlePricePaise,
        regularPricePaise,
        serviceIds: bundleServiceIds
      };
    }
  }
  return best;
}

export function removeBundle(scope = {}) {
  return statements.removeBundle.run(scope).changes;
}

export const hhBundlesRepo = {
  createBundle,
  listBundles,
  getActiveHHBundles,
  matchBundle,
  removeBundle
};
