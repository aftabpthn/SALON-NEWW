import { happyHoursRepo } from "../repositories/happy-hours.repo.js";
import { hhBundlesRepo } from "../repositories/hh-bundles.repo.js";
import { flashSaleRepo } from "../repositories/flash-sale.repo.js";
import { happyHoursEngine } from "./happy-hours-engine.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function servicePricePaise(service = {}) {
  const explicit = Number(service.pricePaise ?? service.price_paise ?? 0);
  if (explicit > 0) return Math.round(explicit);
  return Math.max(0, Math.round((Number(service.price ?? service.unit_price ?? service.unitPrice ?? 0) || 0) * 100));
}

function serviceId(service = {}) {
  return String(service.id ?? service.serviceId ?? service.service_id ?? itemIdOf(service) ?? "").trim();
}

function itemIdOf(service = {}) {
  return service.item_id || service.itemId || "";
}

function dayMatches(dayOfWeek = "", dayName = "") {
  return dayOfWeek === "everyday" || String(dayOfWeek || "").split(",").map((day) => day.trim()).includes(dayName);
}

function dateMatches(hh = {}, dateStr = "") {
  return (!hh.validFrom || hh.validFrom <= dateStr) && (!hh.validTo || hh.validTo >= dateStr);
}

function coversService(hh = {}, id = "") {
  if (hh.applicableTo === "all") return true;
  if (hh.applicableTo !== "services") return false;
  return (hh.services || []).some((service) => String(service.serviceId) === String(id));
}

function activeHours(scope = {}) {
  if (!scope.tenantId || !scope.branchId) return [];
  return happyHoursEngine.getActiveHappyHours(scope);
}

function flashSaleForSlot(scope = {}, date) {
  if (!scope.tenantId || !scope.branchId || !date || Number.isNaN(date.getTime())) return null;
  const { nowTime, nowDate } = happyHoursEngine.getISTComponents(date);
  return flashSaleRepo.getActiveForSlot({
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    slotDate: nowDate,
    slotTime: nowTime
  });
}

function allActiveHours(scope = {}) {
  if (!scope.tenantId || !scope.branchId) return [];
  return happyHoursRepo.list({ tenantId: scope.tenantId, branchId: scope.branchId, status: "active", limit: 100, offset: 0 }).rows || [];
}

export function enrichServicesWithHappyHours(services = [], scope = {}) {
  const active = activeHours(scope);
  const bundles = hhBundlesRepo.getActiveHHBundles(scope);
  const serviceNames = new Map((services || []).map((service) => [serviceId(service), service.name || service.serviceName || "service"]));
  return (services || []).map((service) => {
    const pricePaise = servicePricePaise(service);
    const id = serviceId(service);
    const bundleSuggestion = bundleSuggestionForService({ id, bundles, serviceNames });
    if (!active.length || !pricePaise) return { ...service, pricePaise, happyHour: null, bundleSuggestion };

    for (const hh of active) {
      if (!coversService(hh, id)) continue;
      let discountPaise = 0;
      if (hh.discountType === "percent") {
        discountPaise = Math.floor(pricePaise * hh.discountValue / 100);
        if (hh.maxDiscountPaise > 0) discountPaise = Math.min(discountPaise, hh.maxDiscountPaise);
      } else if (hh.discountType === "flat") {
        discountPaise = Math.min(hh.discountValue, pricePaise);
      }
      if (discountPaise <= 0) continue;
      return {
        ...service,
        pricePaise,
        happyHour: {
          id: hh.id,
          name: hh.name,
          discountPaise,
          finalPricePaise: pricePaise - discountPaise,
          discountType: hh.discountType,
          discountValue: hh.discountValue,
          timeRange: `${hh.startTime}-${hh.endTime}`
        },
        bundleSuggestion
      };
    }
    return { ...service, pricePaise, happyHour: null, bundleSuggestion };
  });
}

function bundleSuggestionForService({ id, bundles, serviceNames }) {
  const match = (bundles || []).find((bundle) => (bundle.services || []).some((service) => String(service.serviceId) === String(id)));
  if (!match) return null;
  const addServiceIds = (match.services || [])
    .map((service) => String(service.serviceId))
    .filter((serviceIdValue) => serviceIdValue !== String(id));
  if (!addServiceIds.length) return null;
  return {
    bundleId: match.id,
    bundleName: match.name,
    addServiceIds,
    addServiceNames: addServiceIds.map((serviceIdValue) => serviceNames.get(serviceIdValue) || serviceIdValue),
    percentOff: match.percentOff || null,
    bundlePricePaise: match.bundlePricePaise || null
  };
}

export function enrichSlotsWithHappyHours(slots = [], scope = {}) {
  const offers = allActiveHours(scope);

  return (slots || []).map((slot) => {
    const rawStart = slot.startAt || slot.start_at || slot.dateTime || "";
    const date = rawStart ? new Date(rawStart) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return { ...slot, hasHappyHour: false, happyHourOffers: [] };
    }
    const { nowTime, nowDay, nowDate } = happyHoursEngine.getISTComponents(date);
    const activeAtSlot = offers.filter((hh) =>
      hh.status === "active" &&
      hh.startTime <= nowTime &&
      hh.endTime > nowTime &&
      dayMatches(hh.dayOfWeek, nowDay) &&
      dateMatches(hh, nowDate)
    );
    const flashSale = flashSaleForSlot(scope, date);

    return {
      ...slot,
      hasHappyHour: activeAtSlot.length > 0 || Boolean(flashSale),
      flashSale,
      happyHourOffers: [
        ...activeAtSlot.map((hh) => ({
          name: hh.name,
          discountType: hh.discountType,
          discountValue: hh.discountValue
        })),
        ...(flashSale ? [{
          name: "Last-minute flash sale",
          discountType: "percent",
          discountValue: flashSale.discountPercent
        }] : [])
      ]
    };
  });
}

export function buildUpcomingHappyHoursSchedule(scope = {}, count = 7) {
  const offers = allActiveHours(scope);
  const schedule = [];
  for (let i = 0; i < count; i += 1) {
    const { nowDay, nowDate } = happyHoursEngine.getISTComponents(new Date(Date.now() + i * DAY_MS));
    const matching = offers.filter((hh) => dayMatches(hh.dayOfWeek, nowDay) && dateMatches(hh, nowDate));
    if (matching.length) {
      schedule.push({ date: nowDate, dayName: nowDay, offers: matching });
    }
  }
  return schedule;
}

export function servicesPricingForHappyHours(serviceIds = [], scope = {}) {
  const active = activeHours(scope);
  const pricing = (serviceIds || []).map((id) => {
    for (const hh of active) {
      if (coversService(hh, id)) {
        return {
          serviceId: id,
          hasHappyHour: true,
          happyHourId: hh.id,
          happyHourName: hh.name,
          discountType: hh.discountType,
          discountValue: hh.discountValue,
          startTime: hh.startTime,
          endTime: hh.endTime
        };
      }
    }
    return { serviceId: id, hasHappyHour: false };
  });
  return { pricing, activeHours: active };
}
