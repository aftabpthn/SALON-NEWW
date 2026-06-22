import { happyHoursRepo } from "../repositories/happy-hours.repo.js";
import { hhBundlesRepo } from "../repositories/hh-bundles.repo.js";
import { happyHoursEngine } from "./happy-hours-engine.js";

const toPaise = (value) => Math.max(0, Math.round((Number(value) || 0) * 100));
const fromPaise = (value) => Math.round(Number(value || 0)) / 100;

function quantityOf(item = {}) {
  return Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
}

function unitPricePaiseOf(item = {}) {
  if (item.pricePaise !== undefined) return Math.max(0, Math.round(Number(item.pricePaise) || 0));
  return toPaise(item.unit_price ?? item.unitPrice ?? item.price ?? 0);
}

function durationMinsOf(item = {}) {
  return Math.max(0, Number.parseInt(item.durationMins ?? item.durationMinutes ?? item.duration_mins ?? item.duration_minutes ?? 0, 10) || 0);
}

function serviceIdOf(item = {}) {
  const itemType = item.item_type || item.itemType || item.type || "service";
  if (itemType !== "service") return "";
  return String(item.serviceId ?? item.service_id ?? item.item_id ?? item.itemId ?? item.id ?? "").trim();
}

function isServiceItem(item = {}) {
  const itemType = item.item_type || item.itemType || item.type || "service";
  return itemType === "service";
}

function existingDiscountPaise(item = {}, grossPaise = 0) {
  if (item.discount_amount !== undefined || item.discountAmount !== undefined) {
    return toPaise(item.discount_amount ?? item.discountAmount);
  }
  const discountType = item.discount_type || item.discountType || "amount";
  const discountValue = Number(item.discount_value ?? item.discountValue ?? 0) || 0;
  if (!discountValue) return 0;
  if (discountType === "percent" || discountType === "percentage") {
    return Math.min(grossPaise, Math.floor(grossPaise * discountValue / 100));
  }
  return Math.min(grossPaise, toPaise(discountValue));
}

function withCombinedDiscount(item, previewItem) {
  const qty = quantityOf(item);
  const unitPricePaise = unitPricePaiseOf(item);
  const happyHourLineDiscountPaise = Math.max(0, Number(previewItem.happyHourDiscountPaise || 0) * qty);
  const combinedDiscountPaise = existingDiscountPaise(item, unitPricePaise * qty) + happyHourLineDiscountPaise;
  const enriched = {
    ...item,
    originalPricePaise: unitPricePaise,
    finalPricePaise: previewItem.finalPricePaise ?? unitPricePaise,
    happyHourDiscountPaise: Number(previewItem.happyHourDiscountPaise || 0),
    happyHourLineDiscountPaise,
    happyHourDurationBonusPaise: Number(previewItem.happyHourDurationBonusPaise || 0),
    happyHourDurationTierId: previewItem.happyHourDurationTierId || null,
    happyHourId: previewItem.happyHourId || null,
    happyHourName: previewItem.happyHourName || ""
  };

  if (combinedDiscountPaise > 0) {
    enriched.discount_type = "amount";
    enriched.discount_value = fromPaise(combinedDiscountPaise);
    enriched.discount_reason = enriched.happyHourId ? "happy_hours" : (item.discount_reason || item.discountReason || "");
  }

  return enriched;
}

function emptyResult(items) {
  return {
    items: items.map((item) => ({ ...item, happyHourDiscountPaise: 0, happyHourId: null })),
    totalDiscountPaise: 0,
    happyHourDiscountPaise: 0,
    groupDiscountPaise: 0,
    groupDiscountLabel: "",
    bundleSavingsPaise: 0,
    bundleName: "",
    bundleMatch: null,
    appliedHappyHourIds: [],
    appliedHappyHours: []
  };
}

export function processHappyHoursForInvoice({ tenantId, branchId, items = [], bypass = false, date, groupSize = 1 } = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (bypass) {
    return emptyResult(sourceItems);
  }

  const cartItems = sourceItems.map((item) => ({
    serviceId: serviceIdOf(item),
    pricePaise: isServiceItem(item) ? unitPricePaiseOf(item) : 0,
    durationMins: durationMinsOf(item),
    qty: quantityOf(item)
  }));
  const result = happyHoursEngine.applyToCart({ tenantId, branchId, cartItems, date });
  const itemsWithDiscounts = sourceItems.map((item, index) => withCombinedDiscount(item, result.items[index] || {}));
  const cartTotalPaise = cartItems.reduce((sum, item) => sum + Number(item.pricePaise || 0) * Number(item.qty || 1), 0);
  const groupResult = happyHoursEngine.calculateGroupDiscount({ groupSize, cartTotalPaise });
  const bundleMatch = hhBundlesRepo.matchBundle({
    tenantId,
    branchId,
    serviceIds: cartItems.map((item) => item.serviceId).filter(Boolean),
    items: cartItems
  });
  const bundleSavingsPaise = Number(bundleMatch?.bundleSavingsPaise || 0);
  const appliedHappyHours = result.appliedHappyHourIds
    .map((id) => happyHoursRepo.getById({ id, tenantId, branchId }))
    .filter(Boolean);
  const happyHourDiscountPaise = Number(result.totalDiscountPaise || 0);
  const totalDiscountPaise = happyHourDiscountPaise + Number(groupResult.groupDiscountPaise || 0) + bundleSavingsPaise;

  return {
    ...result,
    totalDiscountPaise,
    happyHourDiscountPaise,
    groupDiscountPaise: Number(groupResult.groupDiscountPaise || 0),
    groupDiscountLabel: groupResult.groupDiscountLabel || "",
    bundleSavingsPaise,
    bundleName: bundleMatch?.bundleName || "",
    bundleMatch,
    items: itemsWithDiscounts,
    appliedHappyHours
  };
}

export function saveHappyHoursAudit({ tenantId, branchId, invoiceId, appliedHappyHours = [], totalDiscountPaise = 0 } = {}) {
  if (!appliedHappyHours.length || !totalDiscountPaise) return;
  for (const hh of appliedHappyHours) {
    happyHoursRepo.recordAudit({
      tenantId,
      branchId,
      invoiceId,
      happyHourId: hh.id,
      happyHourName: hh.name,
      totalDiscountPaise
    });
  }
}

export const billingHappyHours = {
  processHappyHoursForInvoice,
  saveHappyHoursAudit
};
