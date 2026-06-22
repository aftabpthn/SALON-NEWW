import { happyHoursEngine } from "./happy-hours-engine.js";

function pricePaise(item = {}) {
  if (item.pricePaise !== undefined) return Math.max(0, Math.round(Number(item.pricePaise) || 0));
  return Math.max(0, Math.round((Number(item.unit_price ?? item.unitPrice ?? item.price ?? 0) || 0) * 100));
}

function qty(item = {}) {
  return Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
}

export async function buildContext({
  tenantId,
  branchId,
  cartItems = [],
  groupSize,
  clientId,
  staffId,
  occupancyRate,
  clientSegment,
  weatherCondition,
  currentDate
} = {}) {
  const now = currentDate ? new Date(currentDate) : new Date();
  const { nowTime, nowDay, nowDate } = happyHoursEngine.getISTComponents(now);
  const normalizedItems = (Array.isArray(cartItems) ? cartItems : []).map((item) => ({
    ...item,
    serviceId: String(item.serviceId ?? item.service_id ?? item.item_id ?? item.itemId ?? item.id ?? "").trim(),
    pricePaise: pricePaise(item),
    qty: qty(item)
  }));

  return {
    tenantId,
    branchId,
    dayOfWeek: nowDay,
    timeRange: nowTime,
    currentDate: nowDate,
    dateRange: nowDate,
    cartItems: normalizedItems,
    cartTotalPaise: normalizedItems.reduce((sum, item) => sum + item.pricePaise * item.qty, 0),
    occupancyRate: Number.isFinite(Number(occupancyRate)) ? Number(occupancyRate) : 1,
    clientSegment: clientSegment || "regular",
    groupSize: Math.max(1, Number.parseInt(groupSize, 10) || 1),
    clientId: clientId || null,
    staffId: staffId || null,
    serviceCategory: normalizedItems[0]?.category || normalizedItems[0]?.serviceCategory || null,
    weatherCondition: weatherCondition || null
  };
}

export const contextBuilder = { buildContext };
