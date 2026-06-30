import { db } from "../db.js";
import { tenantService } from "./tenant.service.js";
import { badRequest } from "../utils/app-error.js";

const SETTING_PREFIX = "tax.settings";

const TAX_PRESETS = {
  IN: { country: "IN", countryLabel: "India", taxType: "GST", registrationLabel: "GSTIN", serviceTaxRate: 18, productTaxRate: 18, serviceTaxMode: "Including", productTaxMode: "Excluding" },
  AE: { country: "AE", countryLabel: "UAE", taxType: "VAT", registrationLabel: "TRN", serviceTaxRate: 5, productTaxRate: 5, serviceTaxMode: "Excluding", productTaxMode: "Excluding" },
  US: { country: "US", countryLabel: "United States", taxType: "Sales Tax", registrationLabel: "Tax ID / EIN", serviceTaxRate: 0, productTaxRate: 0, serviceTaxMode: "Excluding", productTaxMode: "Excluding" },
  UK: { country: "UK", countryLabel: "United Kingdom", taxType: "VAT", registrationLabel: "VAT No", serviceTaxRate: 20, productTaxRate: 20, serviceTaxMode: "Excluding", productTaxMode: "Excluding" },
  EU: { country: "EU", countryLabel: "European Union", taxType: "VAT", registrationLabel: "VAT No", serviceTaxRate: 20, productTaxRate: 20, serviceTaxMode: "Excluding", productTaxMode: "Excluding" }
};

const DEFAULT_SETTINGS = {
  ...TAX_PRESETS.IN,
  stateProvince: "",
  registrationNumber: "",
  serviceTaxEnabled: true,
  productTaxApplicable: true,
  taxEditableOnPos: true,
  billLabel: "CIN NO.",
  billValue: "",
  debitCreditFeesEnabled: false,
  debitCreditFeesLabel: "",
  debitCreditFeesValue: 0,
  defaultApplyMode: "newOnly"
};

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
}

function stringValue(value, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 120);
}

function modeValue(value, fallback = "Excluding") {
  return value === "Including" ? "Including" : fallback;
}

function applyModeValue(value) {
  return value === "existingLater" ? "existingLater" : "newOnly";
}

function tenantIdFrom(access = {}) {
  const tenantId = access.tenantId || "";
  if (!tenantId) throw badRequest("tenantId is required");
  return tenantId;
}

function branchIdFrom(input = {}, access = {}) {
  const branchId = input.branchId || access.branchId || "";
  if (branchId) tenantService.assertBranchAccess(access, branchId);
  return branchId;
}

function presetFor(country = "") {
  return TAX_PRESETS[String(country || "").toUpperCase()] || TAX_PRESETS.IN;
}

function settingKey(branchId) {
  return `${SETTING_PREFIX}.${branchId || "all"}`;
}

function normalizeSettings(input = {}) {
  const preset = presetFor(input.country || DEFAULT_SETTINGS.country);
  return {
    ...DEFAULT_SETTINGS,
    ...preset,
    country: stringValue(input.country || preset.country, preset.country).toUpperCase(),
    countryLabel: stringValue(input.countryLabel || preset.countryLabel, preset.countryLabel),
    stateProvince: stringValue(input.stateProvince, ""),
    taxType: stringValue(input.taxType || preset.taxType, preset.taxType),
    registrationLabel: stringValue(input.registrationLabel || preset.registrationLabel, preset.registrationLabel),
    registrationNumber: stringValue(input.registrationNumber, ""),
    serviceTaxEnabled: input.serviceTaxEnabled !== false,
    productTaxApplicable: input.productTaxApplicable !== false,
    taxEditableOnPos: input.taxEditableOnPos !== false,
    serviceTaxRate: numberValue(input.serviceTaxRate, preset.serviceTaxRate),
    productTaxRate: numberValue(input.productTaxRate, preset.productTaxRate),
    serviceTaxMode: modeValue(input.serviceTaxMode, preset.serviceTaxMode),
    productTaxMode: modeValue(input.productTaxMode, preset.productTaxMode),
    billLabel: stringValue(input.billLabel, DEFAULT_SETTINGS.billLabel),
    billValue: stringValue(input.billValue, ""),
    debitCreditFeesEnabled: input.debitCreditFeesEnabled === true,
    debitCreditFeesLabel: stringValue(input.debitCreditFeesLabel, ""),
    debitCreditFeesValue: numberValue(input.debitCreditFeesValue, 0),
    defaultApplyMode: applyModeValue(input.defaultApplyMode)
  };
}

export const taxSettingsService = {
  presets() {
    return TAX_PRESETS;
  },

  get(query = {}, access = {}) {
    const tenantId = tenantIdFrom(access);
    const branchId = branchIdFrom(query, access);
    const key = settingKey(branchId);
    const row = db.prepare("SELECT value FROM settings WHERE tenantId = @tenantId AND key = @key").get({ tenantId, key });
    const saved = parseJson(row?.value, null);
    return { branchId, presets: TAX_PRESETS, settings: normalizeSettings(saved?.settings || saved || DEFAULT_SETTINGS) };
  },

  save(payload = {}, access = {}) {
    const tenantId = tenantIdFrom(access);
    const branchId = branchIdFrom(payload, access);
    const key = settingKey(branchId);
    const settings = normalizeSettings(payload.settings || payload);
    const now = new Date().toISOString();
    const id = `setting_${tenantId}_${key}`.replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 120);
    db.prepare(`
      INSERT INTO settings (id, tenantId, key, value, scope, createdAt, updatedAt)
      VALUES (@id, @tenantId, @key, @value, @scope, @createdAt, @updatedAt)
      ON CONFLICT(tenantId, key) DO UPDATE SET
        value = excluded.value,
        scope = excluded.scope,
        updatedAt = excluded.updatedAt
    `).run({
      id,
      tenantId,
      key,
      value: JSON.stringify({ branchId, settings }),
      scope: branchId ? "branch" : "tenant",
      createdAt: now,
      updatedAt: now
    });
    return { branchId, presets: TAX_PRESETS, settings };
  }
};
