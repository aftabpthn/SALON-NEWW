import { db } from "../db.js";
import { tenantService } from "./tenant.service.js";
import { badRequest } from "../utils/app-error.js";

const SETTING_PREFIX = "clients.customForm";

const DEFAULT_FIELDS = [
  { key: "name", label: "Name", default: true, mandatory: true, displayOnBookNow: true, lockedDefault: true, lockedMandatory: true },
  { key: "contact", label: "Contact", default: true, mandatory: true, displayOnBookNow: true, lockedDefault: true, lockedMandatory: true },
  { key: "email", label: "Email", default: false, mandatory: false, displayOnBookNow: false },
  { key: "dateOfBirth", label: "Date Of Birth", default: true, mandatory: false, displayOnBookNow: false },
  { key: "dateOfAnniversary", label: "Date Of Anniversary", default: true, mandatory: false, displayOnBookNow: false },
  { key: "gender", label: "Gender", default: true, mandatory: false, displayOnBookNow: false },
  { key: "address", label: "Address", default: false, mandatory: false, displayOnBookNow: false },
  { key: "gstNumber", label: "GST Number", default: false, mandatory: false, displayOnBookNow: false },
  { key: "parentName", label: "Parent Name", default: false, mandatory: false, displayOnBookNow: false },
  { key: "parentContact", label: "Parent Contact", default: false, mandatory: false, displayOnBookNow: false },
  { key: "childAge", label: "Child Age", default: false, mandatory: false, displayOnBookNow: false },
  { key: "cardNumber", label: "Card Number", default: false, mandatory: false, displayOnBookNow: false },
  { key: "clientDiscountPercentage", label: "Client Discount Percentage", default: false, mandatory: false, displayOnBookNow: false },
  { key: "clientPicture", label: "Client Picture", default: false, mandatory: false, displayOnBookNow: false }
];

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
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

function settingKey(branchId) {
  return `${SETTING_PREFIX}.${branchId || "all"}`;
}

function normalizeFields(input = []) {
  const source = new Map((Array.isArray(input) ? input : []).map((field) => [String(field?.key || ""), field]));
  return DEFAULT_FIELDS.map((base) => {
    const saved = source.get(base.key) || {};
    const lockedDefault = base.lockedDefault === true;
    const lockedMandatory = base.lockedMandatory === true;
    return {
      ...base,
      default: lockedDefault ? true : saved.default === true,
      mandatory: lockedMandatory ? true : saved.mandatory === true,
      displayOnBookNow: saved.displayOnBookNow === true || (base.displayOnBookNow === true && saved.displayOnBookNow !== false),
      lockedDefault,
      lockedMandatory
    };
  });
}

export const clientCustomFormSettingsService = {
  defaults() {
    return normalizeFields(DEFAULT_FIELDS);
  },

  get(query = {}, access = {}) {
    const tenantId = tenantIdFrom(access);
    const branchId = branchIdFrom(query, access);
    const key = settingKey(branchId);
    const row = db.prepare("SELECT value FROM settings WHERE tenantId = @tenantId AND key = @key").get({ tenantId, key });
    const saved = parseJson(row?.value, null);
    return { branchId, fields: normalizeFields(saved?.fields) };
  },

  save(payload = {}, access = {}) {
    const tenantId = tenantIdFrom(access);
    const branchId = branchIdFrom(payload, access);
    const key = settingKey(branchId);
    const fields = normalizeFields(payload.fields);
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
      value: JSON.stringify({ branchId, fields }),
      scope: branchId ? "branch" : "tenant",
      createdAt: now,
      updatedAt: now
    });
    return { branchId, fields };
  }
};
