import { db } from "../db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS whiteLabelRuleSettings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenantId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    displayName TEXT NOT NULL DEFAULT 'Happy Hours',
    customerDiscountLabel TEXT NOT NULL DEFAULT 'Special offer',
    customerAppliedLabel TEXT NOT NULL DEFAULT 'Offer applied',
    customerBundleLabel TEXT NOT NULL DEFAULT 'Bundle price',
    customerLimitedTimeLabel TEXT NOT NULL DEFAULT 'Limited-time price',
    publicRuleNameFallback TEXT NOT NULL DEFAULT 'Salon offer',
    hideInternalRuleNames INTEGER NOT NULL DEFAULT 1,
    labelsJson TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    createdBy TEXT DEFAULT NULL,
    createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(tenantId, branchId)
  );

  CREATE INDEX IF NOT EXISTS idx_whiteLabelRuleSettings_scope
    ON whiteLabelRuleSettings(tenantId, branchId, status);
`);

const statements = {
  upsert: db.prepare(`
    INSERT INTO whiteLabelRuleSettings (
      tenantId, branchId, displayName, customerDiscountLabel, customerAppliedLabel,
      customerBundleLabel, customerLimitedTimeLabel, publicRuleNameFallback,
      hideInternalRuleNames, labelsJson, status, createdBy
    )
    VALUES (
      @tenantId, @branchId, @displayName, @customerDiscountLabel, @customerAppliedLabel,
      @customerBundleLabel, @customerLimitedTimeLabel, @publicRuleNameFallback,
      @hideInternalRuleNames, @labelsJson, @status, @createdBy
    )
    ON CONFLICT(tenantId, branchId)
    DO UPDATE SET
      displayName = excluded.displayName,
      customerDiscountLabel = excluded.customerDiscountLabel,
      customerAppliedLabel = excluded.customerAppliedLabel,
      customerBundleLabel = excluded.customerBundleLabel,
      customerLimitedTimeLabel = excluded.customerLimitedTimeLabel,
      publicRuleNameFallback = excluded.publicRuleNameFallback,
      hideInternalRuleNames = excluded.hideInternalRuleNames,
      labelsJson = excluded.labelsJson,
      status = excluded.status,
      updatedAt = strftime('%s','now')
  `),
  get: db.prepare(`
    SELECT * FROM whiteLabelRuleSettings
    WHERE tenantId = @tenantId
      AND branchId = @branchId
    LIMIT 1
  `)
};

const defaultLabels = {
  discountProgramName: "Happy Hours",
  discountBadge: "Special offer",
  discountApplied: "Offer applied",
  bundlePrice: "Bundle price",
  limitedTime: "Limited-time price",
  ruleName: "Salon offer"
};

function requireScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const branchId = String(scope.branchId || "").trim();
  if (!tenantId || !branchId) throw new Error("tenantId and branchId are required");
  return { tenantId, branchId };
}

function parseJson(value, fallback = {}) {
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

function shortText(value, fallback, maxLength = 80) {
  const text = String(value || fallback || "").trim();
  return text.slice(0, maxLength);
}

function boolInt(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === 1 || value === "1" || value === "true") return 1;
  if (value === 0 || value === "0" || value === "false") return 0;
  return value ? 1 : 0;
}

function normalize(data = {}) {
  const labels = data.labels && typeof data.labels === "object" ? data.labels : parseJson(data.labelsJson, {});
  return {
    ...requireScope(data),
    displayName: shortText(data.displayName, defaultLabels.discountProgramName),
    customerDiscountLabel: shortText(data.customerDiscountLabel ?? labels.discountBadge, defaultLabels.discountBadge),
    customerAppliedLabel: shortText(data.customerAppliedLabel ?? labels.discountApplied, defaultLabels.discountApplied),
    customerBundleLabel: shortText(data.customerBundleLabel ?? labels.bundlePrice, defaultLabels.bundlePrice),
    customerLimitedTimeLabel: shortText(data.customerLimitedTimeLabel ?? labels.limitedTime, defaultLabels.limitedTime),
    publicRuleNameFallback: shortText(data.publicRuleNameFallback ?? labels.ruleName, defaultLabels.ruleName),
    hideInternalRuleNames: boolInt(data.hideInternalRuleNames, true),
    labelsJson: jsonText({
      ...labels,
      discountProgramName: shortText(data.displayName ?? labels.discountProgramName, defaultLabels.discountProgramName),
      discountBadge: shortText(data.customerDiscountLabel ?? labels.discountBadge, defaultLabels.discountBadge),
      discountApplied: shortText(data.customerAppliedLabel ?? labels.discountApplied, defaultLabels.discountApplied),
      bundlePrice: shortText(data.customerBundleLabel ?? labels.bundlePrice, defaultLabels.bundlePrice),
      limitedTime: shortText(data.customerLimitedTimeLabel ?? labels.limitedTime, defaultLabels.limitedTime),
      ruleName: shortText(data.publicRuleNameFallback ?? labels.ruleName, defaultLabels.ruleName)
    }, defaultLabels),
    status: String(data.status || "active").trim() === "paused" ? "paused" : "active",
    createdBy: data.createdBy || null
  };
}

function defaultSettings(scope = {}) {
  return {
    ...requireScope(scope),
    id: null,
    displayName: defaultLabels.discountProgramName,
    customerDiscountLabel: defaultLabels.discountBadge,
    customerAppliedLabel: defaultLabels.discountApplied,
    customerBundleLabel: defaultLabels.bundlePrice,
    customerLimitedTimeLabel: defaultLabels.limitedTime,
    publicRuleNameFallback: defaultLabels.ruleName,
    hideInternalRuleNames: true,
    labels: { ...defaultLabels },
    status: "active",
    configured: false
  };
}

function parseRow(row, scope = {}) {
  if (!row) return defaultSettings(scope);
  const labels = {
    ...defaultLabels,
    ...parseJson(row.labelsJson, {})
  };
  return {
    ...row,
    hideInternalRuleNames: Boolean(row.hideInternalRuleNames),
    labels,
    configured: true
  };
}

function safeRuleName(settings, rule = {}) {
  if (!settings.hideInternalRuleNames && rule.publicName) return shortText(rule.publicName, settings.publicRuleNameFallback);
  if (!settings.hideInternalRuleNames && rule.customerLabel) return shortText(rule.customerLabel, settings.publicRuleNameFallback);
  return settings.publicRuleNameFallback;
}

export function getSettings(scope = {}) {
  const current = requireScope(scope);
  return parseRow(statements.get.get(current), current);
}

export function saveSettings(data = {}) {
  const payload = normalize(data);
  statements.upsert.run(payload);
  return getSettings(payload);
}

export function resolvePublicLabels(scope = {}) {
  const settings = getSettings(scope);
  const labels = {
    discountProgramName: settings.displayName,
    discountBadge: settings.customerDiscountLabel,
    discountApplied: settings.customerAppliedLabel,
    bundlePrice: settings.customerBundleLabel,
    limitedTime: settings.customerLimitedTimeLabel,
    ruleName: safeRuleName(settings, scope.rule || {})
  };
  return {
    tenantId: settings.tenantId,
    branchId: settings.branchId,
    status: settings.status,
    labels: {
      ...settings.labels,
      ...labels
    },
    hideInternalRuleNames: settings.hideInternalRuleNames,
    safeForPublicSurfaces: true
  };
}

export const whiteLabelRulesRepo = {
  getSettings,
  saveSettings,
  resolvePublicLabels
};
