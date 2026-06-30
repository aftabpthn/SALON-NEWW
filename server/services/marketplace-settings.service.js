import { db } from "../db.js";
import { tenantService } from "./tenant.service.js";
import { badRequest } from "../utils/app-error.js";

const SETTING_PREFIX = "marketplace.reputation.settings";

const DEFAULT_SETTINGS = {
  internalReviews: true,
  marketplaceReviews: true,
  googleReviews: false,
  showReviewsOnBookingProfile: true,
  autoRequestEnabled: true,
  channels: {
    sms: true,
    whatsapp: true,
    email: false
  },
  requestTiming: "twoHours",
  highRatingMin: 4,
  lowRatingMax: 3,
  highRatingDestination: "both",
  lowRatingDestination: "internalRecovery",
  ownerLowRatingAlert: true,
  staffReviewTracking: true,
  serviceReviewTracking: true,
  goodReviewReply: "Thank you for your kind review. We look forward to seeing you again.",
  badReviewReply: "Thank you for sharing this. Our owner will review and connect with you shortly.",
  complaintRecoveryReply: "We are sorry your visit did not meet expectations. Please allow us to make this right.",
  googleReviewUrl: "",
  marketplaceProfileUrl: ""
};

const DEFAULT_SUMMARY = {
  totalReviews: 0,
  averageRating: 0,
  pendingRequests: 0,
  lowRatingAlerts: 0,
  googleRedirects: 0,
  internalComplaints: 0
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

function boolValue(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function stringValue(value, fallback = "", maxLength = 500) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeSettings(input = {}) {
  const channels = input.channels || {};
  const highRatingMin = numberValue(input.highRatingMin, DEFAULT_SETTINGS.highRatingMin, 1, 5);
  const lowRatingMax = Math.min(numberValue(input.lowRatingMax, DEFAULT_SETTINGS.lowRatingMax, 1, 5), highRatingMin - 1);
  return {
    ...DEFAULT_SETTINGS,
    internalReviews: boolValue(input.internalReviews, DEFAULT_SETTINGS.internalReviews),
    marketplaceReviews: boolValue(input.marketplaceReviews, DEFAULT_SETTINGS.marketplaceReviews),
    googleReviews: boolValue(input.googleReviews, DEFAULT_SETTINGS.googleReviews),
    showReviewsOnBookingProfile: boolValue(input.showReviewsOnBookingProfile, DEFAULT_SETTINGS.showReviewsOnBookingProfile),
    autoRequestEnabled: boolValue(input.autoRequestEnabled, DEFAULT_SETTINGS.autoRequestEnabled),
    channels: {
      sms: boolValue(channels.sms, DEFAULT_SETTINGS.channels.sms),
      whatsapp: boolValue(channels.whatsapp, DEFAULT_SETTINGS.channels.whatsapp),
      email: boolValue(channels.email, DEFAULT_SETTINGS.channels.email)
    },
    requestTiming: oneOf(input.requestTiming, ["immediate", "twoHours", "nextDay"], DEFAULT_SETTINGS.requestTiming),
    highRatingMin,
    lowRatingMax,
    highRatingDestination: oneOf(input.highRatingDestination, ["google", "marketplace", "both"], DEFAULT_SETTINGS.highRatingDestination),
    lowRatingDestination: "internalRecovery",
    ownerLowRatingAlert: boolValue(input.ownerLowRatingAlert, DEFAULT_SETTINGS.ownerLowRatingAlert),
    staffReviewTracking: boolValue(input.staffReviewTracking, DEFAULT_SETTINGS.staffReviewTracking),
    serviceReviewTracking: boolValue(input.serviceReviewTracking, DEFAULT_SETTINGS.serviceReviewTracking),
    goodReviewReply: stringValue(input.goodReviewReply, DEFAULT_SETTINGS.goodReviewReply),
    badReviewReply: stringValue(input.badReviewReply, DEFAULT_SETTINGS.badReviewReply),
    complaintRecoveryReply: stringValue(input.complaintRecoveryReply, DEFAULT_SETTINGS.complaintRecoveryReply),
    googleReviewUrl: stringValue(input.googleReviewUrl, "", 300),
    marketplaceProfileUrl: stringValue(input.marketplaceProfileUrl, "", 300)
  };
}

export const marketplaceSettingsService = {
  get(query = {}, access = {}) {
    const tenantId = tenantIdFrom(access);
    const branchId = branchIdFrom(query, access);
    const key = settingKey(branchId);
    const row = db.prepare("SELECT value FROM settings WHERE tenantId = @tenantId AND key = @key").get({ tenantId, key });
    const saved = parseJson(row?.value, null);
    return {
      branchId,
      settings: normalizeSettings(saved?.settings || saved || DEFAULT_SETTINGS),
      summary: DEFAULT_SUMMARY
    };
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
    return { branchId, settings, summary: DEFAULT_SUMMARY };
  }
};
