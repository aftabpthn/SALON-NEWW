import { happyHoursRepo } from "../repositories/happy-hours.repo.js";
import { hhDurationTiersRepo } from "../repositories/hh-duration-tiers.repo.js";

export function getISTComponents(date) {
  const d = date || new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + istOffset);
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return {
    nowTime: `${hh}:${mm}`,
    nowDay: days[ist.getUTCDay()],
    nowDate: ist.toISOString().slice(0, 10)
  };
}

export function getActiveHappyHours({ tenantId, branchId, date }) {
  const { nowTime, nowDay, nowDate } = getISTComponents(date);
  return happyHoursRepo.getActiveNow({ tenantId, branchId, nowTime, nowDay, nowDate });
}

function durationTierBonus({ tenantId, branchId, happyHourId, durationMins, servicePricePaise }) {
  const duration = Number(durationMins || 0);
  if (!duration) return null;
  const tiers = hhDurationTiersRepo.list({ tenantId, branchId, happyHourId });
  return tiers.find((tier) =>
    duration >= Number(tier.minDurationMins || 0) &&
    (tier.maxDurationMins === null || duration <= Number(tier.maxDurationMins || 0))
  ) || null;
}

export function getDiscountForService({ tenantId, branchId, serviceId, servicePricePaise, serviceDurationMins, date }) {
  const activeHours = getActiveHappyHours({ tenantId, branchId, date });
  if (!activeHours.length) return null;

  for (const hh of activeHours) {
    const covers = hh.applicableTo === "all" ||
      (hh.applicableTo === "services" &&
        hh.services?.some((service) => String(service.serviceId) === String(serviceId)));

    if (!covers) continue;

    let discountPaise = 0;
    if (hh.discountType === "percent") {
      discountPaise = Math.floor((Number(servicePricePaise) || 0) * hh.discountValue / 100);
      if (hh.maxDiscountPaise > 0 && discountPaise > hh.maxDiscountPaise) {
        discountPaise = hh.maxDiscountPaise;
      }
    } else if (hh.discountType === "flat") {
      discountPaise = Math.min(hh.discountValue, Number(servicePricePaise) || 0);
    }

    const tier = durationTierBonus({
      tenantId,
      branchId,
      happyHourId: hh.id,
      durationMins: serviceDurationMins,
      servicePricePaise
    });
    const durationBonusPaise = tier ? Math.floor((Number(servicePricePaise) || 0) * Number(tier.bonusPercent || 0) / 100) : 0;
    discountPaise = Math.min(Number(servicePricePaise) || 0, discountPaise + durationBonusPaise);

    if (discountPaise > 0) {
      return {
        happyHour: hh,
        discountPaise,
        finalPricePaise: servicePricePaise - discountPaise,
        durationBonusPaise,
        durationTier: tier
      };
    }
  }
  return null;
}

export function calculateGroupDiscount({ groupSize = 1, cartTotalPaise = 0 } = {}) {
  const size = Math.max(1, Number.parseInt(groupSize, 10) || 1);
  const total = Math.max(0, Math.round(Number(cartTotalPaise) || 0));
  if (size < 3 || !total) return { groupDiscountPaise: 0, groupDiscountLabel: "" };
  const percent = size >= 5 ? 15 : 10;
  return {
    groupDiscountPaise: Math.floor(total * percent / 100),
    groupDiscountLabel: `${percent}% group booking`
  };
}

export function applyToCart({ tenantId, branchId, cartItems, date }) {
  const result = [];
  let totalDiscountPaise = 0;
  const appliedIds = new Set();

  for (const item of cartItems || []) {
    const match = getDiscountForService({
      tenantId,
      branchId,
      serviceId: item.serviceId,
      servicePricePaise: item.pricePaise,
      serviceDurationMins: item.durationMins,
      date
    });

    if (match) {
      const lineDiscount = match.discountPaise * (item.qty || 1);
      totalDiscountPaise += lineDiscount;
      appliedIds.add(match.happyHour.id);
      result.push({
        ...item,
        originalPricePaise: item.pricePaise,
        finalPricePaise: match.finalPricePaise,
        happyHourDiscountPaise: match.discountPaise,
        happyHourDurationBonusPaise: match.durationBonusPaise || 0,
        happyHourDurationTierId: match.durationTier?.id || null,
        happyHourId: match.happyHour.id,
        happyHourName: match.happyHour.name
      });
    } else {
      result.push({ ...item, happyHourDiscountPaise: 0, happyHourId: null });
    }
  }

  return {
    items: result,
    totalDiscountPaise,
    appliedHappyHourIds: [...appliedIds]
  };
}

export const happyHoursEngine = {
  getActiveHappyHours,
  getDiscountForService,
  calculateGroupDiscount,
  applyToCart,
  getISTComponents
};
