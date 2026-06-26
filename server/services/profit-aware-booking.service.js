import { db } from "../db.js";
import { tenantService } from "./tenant.service.js";
import { profitIntelligenceService } from "./profit-intelligence.service.js";

const DEFAULT_PEAK_HOURS = [11, 12, 16, 17, 18];
const LOW_MARGIN_BPS = 2000;
const PREMIUM_MARGIN_BPS = 4500;

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=@name").get({ name }));
}

function safeAll(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toDateText(value = new Date()) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || new Date().toISOString()).slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function periodParams(query = {}, access = {}) {
  const to = toDateText(query.to || query.endDate);
  const from = toDateText(query.from || query.startDate || `${to.slice(0, 7)}-01`);
  const branchId = String(query.branchId || access.branchId || "").trim();
  if (branchId) tenantService.assertBranchAccess(access, branchId);
  return {
    tenantId: access.tenantId,
    branchId,
    from,
    to,
    startAt: `${from}T00:00:00`,
    endAt: `${to}T23:59:59`
  };
}

function hourOf(startAt = "") {
  const hourText = String(startAt || "").slice(11, 13);
  const textHour = /^\d{2}$/.test(hourText) ? Number(hourText) : NaN;
  if (Number.isFinite(textHour)) return textHour;
  const date = new Date(startAt);
  return Number.isNaN(date.getTime()) ? 11 : date.getHours();
}

function normalizeServiceId(value = "") {
  return String(value || "").trim();
}

export class ProfitAwareBookingService {
  recommendations(query = {}, access = {}) {
    const params = periodParams(query, access);
    const breakdown = profitIntelligenceService.breakdown(query, access);
    const appointmentRows = this.appointmentHistory(params);
    const serviceDemand = this.serviceHourDemand(appointmentRows);
    const fallbackDemand = this.fallbackHourDemand(appointmentRows);
    const categoryMargins = new Map((breakdown.categoryProfit || []).map((row) => [row.category, Number(row.netMarginBps || 0)]));
    const serviceFilter = new Set(String(query.serviceId || query.serviceIds || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean));
    const serviceRows = (breakdown.serviceProfit || [])
      .filter((service) => !serviceFilter.size || serviceFilter.has(String(service.serviceId || "")))
      .slice(0, 12);

    return {
      period: { from: params.from, to: params.to, branchId: params.branchId },
      recommendations: serviceRows.map((service) => this.recommendServiceSlot(service, params, serviceDemand, fallbackDemand, categoryMargins)),
      sourceHealth: {
        services: serviceRows.length,
        categories: (breakdown.categoryProfit || []).length,
        appointments: appointmentRows.length,
        source: "profitIntelligence.serviceProfit + categoryProfit + appointments"
      }
    };
  }

  appointmentHistory(params) {
    if (!tableExists("appointments")) return [];
    return safeAll(`
      SELECT id, branchId, serviceIds, startAt, status
      FROM appointments
      WHERE tenantId = @tenantId
        AND startAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, 'booked')) NOT IN ('void', 'cancelled', 'canceled', 'no-show')
        AND (@branchId = '' OR branchId = @branchId)
      ORDER BY startAt DESC
      LIMIT 5000
    `, params);
  }

  serviceHourDemand(appointments = []) {
    const demand = new Map();
    for (const appointment of appointments) {
      const hour = hourOf(appointment.startAt);
      for (const serviceId of parseJsonArray(appointment.serviceIds).map(normalizeServiceId).filter(Boolean)) {
        const key = `${serviceId}|${hour}`;
        demand.set(key, Number(demand.get(key) || 0) + 1);
      }
    }
    return demand;
  }

  fallbackHourDemand(appointments = []) {
    const demand = new Map();
    for (const appointment of appointments) {
      const hour = hourOf(appointment.startAt);
      demand.set(hour, Number(demand.get(hour) || 0) + 1);
    }
    return demand;
  }

  recommendServiceSlot(service = {}, params = {}, serviceDemand = new Map(), fallbackDemand = new Map(), categoryMargins = new Map()) {
    const demandRows = DEFAULT_PEAK_HOURS.map((hour) => ({
      hour,
      demand: Number(serviceDemand.get(`${service.serviceId}|${hour}`) || fallbackDemand.get(hour) || 0)
    })).sort((a, b) => b.demand - a.demand || a.hour - b.hour);
    const best = demandRows[0] || { hour: 11, demand: 0 };
    const maxDemand = Math.max(...demandRows.map((row) => row.demand), 1);
    const peakScore = Math.round((best.demand / maxDemand) * 100);
    const invoiceCount = Math.max(1, Number(service.invoiceCount || 1));
    const expectedRevenuePaise = Math.round(Number(service.revenuePaise || 0) / invoiceCount);
    const expectedCostPaise = Math.round((Number(service.productCostPaise || 0) + Number(service.staffCostPaise || 0)) / invoiceCount);
    const expectedProfitPaise = expectedRevenuePaise - expectedCostPaise;
    const marginBps = Number(service.netMarginBps || service.grossMarginBps || categoryMargins.get(service.category) || 0);
    const suggestedPriceUpliftBps = peakScore >= 70 && marginBps >= PREMIUM_MARGIN_BPS ? 500 : peakScore >= 70 ? 250 : 0;
    const restrictionReason = marginBps < LOW_MARGIN_BPS
      ? "Low margin service: avoid peak slots unless price, recipe or commission is adjusted."
      : "";

    return {
      serviceId: service.serviceId || "",
      serviceName: service.serviceName || "Unmapped service",
      slot: `${addDays(params.to, 1)}T${String(best.hour).padStart(2, "0")}:00:00`,
      expectedRevenuePaise,
      expectedCostPaise,
      expectedProfitPaise,
      marginBps,
      peakScore,
      slotProfitabilityScore: Math.max(0, Math.round((marginBps / 100) + peakScore)),
      suggestedPriceUpliftBps,
      recommendation: this.recommendationText({ service, marginBps, peakScore, suggestedPriceUpliftBps, restrictionReason }),
      restrictionReason
    };
  }

  recommendationText({ service = {}, marginBps = 0, peakScore = 0, suggestedPriceUpliftBps = 0, restrictionReason = "" }) {
    if (restrictionReason) return `${service.serviceName || "Service"} low margin hai. Peak hour me restrict karein ya price/recipe review karein.`;
    if (peakScore >= 70 && suggestedPriceUpliftBps > 0) return `${service.serviceName || "Service"} high-margin peak demand me strong hai. Peak slot recommend karein with ${Math.round(suggestedPriceUpliftBps / 100)}% uplift.`;
    if (marginBps >= PREMIUM_MARGIN_BPS) return `${service.serviceName || "Service"} high profit service hai. Prime slots me prioritize karein.`;
    return `${service.serviceName || "Service"} standard slot fit hai. Margin improve karne ke liye add-on attach karein.`;
  }
}

export const profitAwareBookingService = new ProfitAwareBookingService();
