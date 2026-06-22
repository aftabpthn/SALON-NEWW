import { competitorPricesRepo } from "../repositories/competitor-prices.repo.js";

export function getMarketAwareDiscount(data = {}) {
  const baseDiscountPercent = Math.min(100, Math.max(0, Number(data.baseDiscountPercent || 0)));
  const position = competitorPricesRepo.getPricePosition({
    tenantId: data.tenantId,
    branchId: data.branchId,
    serviceCategory: data.serviceCategory,
    ourPricePaise: data.ourPricePaise,
    baseDiscountPercent
  });
  return {
    discountPercent: position.recommendedDiscountPercent,
    position: position.position,
    marketAvgPaise: position.avgPaise,
    ourEffectivePricePaise: position.ourEffectivePricePaise,
    priceGapPercent: position.priceGapPercent,
    note: position.note
  };
}

export const marketPricer = { getMarketAwareDiscount };
