import { db } from "../db.js";
import { tenantService } from "./tenant.service.js";
import { badRequest } from "../utils/app-error.js";
import { realtimeService } from "./realtime.service.js";

const SETTING_PREFIX = "general.settings";

const DEFAULT_SETTINGS = {
  workspace: {
    workspaceName: "Aurashine OS",
    defaultLandingPage: "dashboard",
    fastPosEnabled: true
  },
  localization: {
    country: "India",
    language: "English",
    timezone: "Asia/Kolkata",
    currency: "INR",
    locale: "en-IN"
  },
  branchBehavior: {
    rememberLastBranch: true,
    requireBranchSelection: true,
    allowBranchSwitch: true
  },
  dateTime: {
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12h",
    businessDayStartHour: 0,
    weekStartsOn: "Monday"
  },
  interface: {
    compactMode: false,
    showModuleBadges: true,
    enableCommandSearch: true
  },
  defaults: {
    refreshReportsOnOpen: true,
    ownerNotifications: true,
    staffHints: true
  }
};

const DEFAULT_AUDIT = {
  lastChangedBy: "Not saved yet",
  lastChangedAt: ""
};

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

function readSavedSettings(tenantId, branchId) {
  const row = db.prepare("SELECT value FROM settings WHERE tenantId = @tenantId AND key = @key").get({ tenantId, key: settingKey(branchId) });
  return parseJson(row?.value, null);
}

function mergeSettings(base = {}, override = {}) {
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((section) => [
    section,
    { ...(base[section] || {}), ...(override[section] || {}) }
  ]));
}

function boolValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value, fallback, allowed = null) {
  const next = String(value ?? fallback).trim() || fallback;
  return allowed && !allowed.includes(next) ? fallback : next;
}

function numberValue(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeSettings(input = {}) {
  const workspace = input.workspace || {};
  const localization = input.localization || {};
  const branchBehavior = input.branchBehavior || {};
  const dateTime = input.dateTime || {};
  const interfaceSettings = input.interface || {};
  const defaults = input.defaults || {};

  return {
    workspace: {
      workspaceName: stringValue(workspace.workspaceName, DEFAULT_SETTINGS.workspace.workspaceName),
      defaultLandingPage: stringValue(workspace.defaultLandingPage, DEFAULT_SETTINGS.workspace.defaultLandingPage, ["dashboard", "pos", "appointments", "clients", "reports"]),
      fastPosEnabled: boolValue(workspace.fastPosEnabled, DEFAULT_SETTINGS.workspace.fastPosEnabled)
    },
    localization: {
      country: stringValue(localization.country, DEFAULT_SETTINGS.localization.country),
      language: stringValue(localization.language, DEFAULT_SETTINGS.localization.language),
      timezone: stringValue(localization.timezone, DEFAULT_SETTINGS.localization.timezone),
      currency: stringValue(localization.currency, DEFAULT_SETTINGS.localization.currency),
      locale: stringValue(localization.locale, DEFAULT_SETTINGS.localization.locale)
    },
    branchBehavior: {
      rememberLastBranch: boolValue(branchBehavior.rememberLastBranch, DEFAULT_SETTINGS.branchBehavior.rememberLastBranch),
      requireBranchSelection: boolValue(branchBehavior.requireBranchSelection, DEFAULT_SETTINGS.branchBehavior.requireBranchSelection),
      allowBranchSwitch: boolValue(branchBehavior.allowBranchSwitch, DEFAULT_SETTINGS.branchBehavior.allowBranchSwitch)
    },
    dateTime: {
      dateFormat: stringValue(dateTime.dateFormat, DEFAULT_SETTINGS.dateTime.dateFormat, ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]),
      timeFormat: stringValue(dateTime.timeFormat, DEFAULT_SETTINGS.dateTime.timeFormat, ["12h", "24h"]),
      businessDayStartHour: numberValue(dateTime.businessDayStartHour, DEFAULT_SETTINGS.dateTime.businessDayStartHour, 0, 23),
      weekStartsOn: stringValue(dateTime.weekStartsOn, DEFAULT_SETTINGS.dateTime.weekStartsOn, ["Sunday", "Monday"])
    },
    interface: {
      compactMode: boolValue(interfaceSettings.compactMode, DEFAULT_SETTINGS.interface.compactMode),
      showModuleBadges: boolValue(interfaceSettings.showModuleBadges, DEFAULT_SETTINGS.interface.showModuleBadges),
      enableCommandSearch: boolValue(interfaceSettings.enableCommandSearch, DEFAULT_SETTINGS.interface.enableCommandSearch)
    },
    defaults: {
      refreshReportsOnOpen: boolValue(defaults.refreshReportsOnOpen, DEFAULT_SETTINGS.defaults.refreshReportsOnOpen),
      ownerNotifications: boolValue(defaults.ownerNotifications, DEFAULT_SETTINGS.defaults.ownerNotifications),
      staffHints: boolValue(defaults.staffHints, DEFAULT_SETTINGS.defaults.staffHints)
    }
  };
}

function normalizeAudit(input = {}) {
  return {
    lastChangedBy: input.lastChangedBy || DEFAULT_AUDIT.lastChangedBy,
    lastChangedAt: input.lastChangedAt || DEFAULT_AUDIT.lastChangedAt
  };
}

export const generalSettingsService = {
  get(query = {}, access = {}) {
    const tenantId = tenantIdFrom(access);
    const branchId = branchIdFrom(query, access);
    const tenantSaved = readSavedSettings(tenantId, "");
    const branchSaved = branchId ? readSavedSettings(tenantId, branchId) : null;
    const tenantSettings = tenantSaved?.settings || tenantSaved || DEFAULT_SETTINGS;
    const branchSettings = branchSaved?.settings || branchSaved || {};
    const saved = branchSaved || tenantSaved;
    return {
      branchId,
      settings: normalizeSettings(mergeSettings(tenantSettings, branchSettings)),
      audit: normalizeAudit(saved?.audit)
    };
  },

  save(payload = {}, access = {}) {
    const tenantId = tenantIdFrom(access);
    const branchId = branchIdFrom(payload, access);
    const key = settingKey(branchId);
    const settings = normalizeSettings(payload.settings || payload);
    const now = new Date().toISOString();
    const audit = {
      lastChangedBy: access.user?.email || access.user?.id || access.role || "system",
      lastChangedAt: now
    };
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
      value: JSON.stringify({ branchId, settings, audit }),
      scope: branchId ? "branch" : "tenant",
      createdAt: now,
      updatedAt: now
    });
    realtimeService.broadcast("settings.general.updated", { branchId, audit }, {
      tenantId,
      branchId,
      channel: branchId ? `branch:${branchId}` : `tenant:${tenantId}`
    });
    return { branchId, settings, audit };
  },

  ownerNotificationsEnabled(access = {}, branchId = "") {
    return this.get({ branchId }, access).settings.defaults.ownerNotifications;
  },

  ownerNotificationsEnabledForTenant(tenantId, branchId = "") {
    const tenantSaved = readSavedSettings(tenantId, "");
    const branchSaved = branchId ? readSavedSettings(tenantId, branchId) : null;
    const tenantSettings = tenantSaved?.settings || tenantSaved || DEFAULT_SETTINGS;
    const branchSettings = branchSaved?.settings || branchSaved || {};
    return normalizeSettings(mergeSettings(tenantSettings, branchSettings)).defaults.ownerNotifications;
  },

  staffWorkspacePreferences(access = {}) {
    const { settings } = this.get({}, access);
    return {
      workspace: { workspaceName: settings.workspace.workspaceName },
      localization: { timezone: settings.localization.timezone, locale: settings.localization.locale },
      dateTime: settings.dateTime,
      interface: { compactMode: settings.interface.compactMode },
      defaults: { staffHints: settings.defaults.staffHints }
    };
  }
};
