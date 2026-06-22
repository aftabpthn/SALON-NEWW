import { db } from "../db.js";
import { flashSaleRepo } from "../repositories/flash-sale.repo.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

const TRIGGER_HOURS_BEFORE = 2;
const FLASH_DISCOUNT = 30;
const FLASH_DURATION_MINS = 90;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function branchScopes() {
  try {
    return db
      .prepare("SELECT DISTINCT tenantId, branchId FROM happyHours WHERE tenantId IS NOT NULL AND branchId IS NOT NULL")
      .all()
      .filter((row) => row.tenantId && row.branchId);
  } catch (error) {
    console.warn("[FlashSale] Scope lookup skipped", error.message);
    return [];
  }
}

function candidateSlots() {
  const slots = [];
  const now = Date.now();
  for (let mins = 30; mins <= TRIGGER_HOURS_BEFORE * 60; mins += 30) {
    const components = happyHoursEngine.getISTComponents(new Date(now + mins * 60 * 1000));
    slots.push({ slotDate: components.nowDate, slotTime: components.nowTime });
  }
  return slots;
}

function isBooked({ tenantId, branchId, slotDate, slotTime }) {
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM appointments
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND substr(startAt, 1, 10) = @slotDate
        AND substr(startAt, 12, 5) = @slotTime
        AND status NOT IN ('cancelled', 'no_show')
    `).get({ tenantId, branchId, slotDate, slotTime });
    return Number(row?.count || 0) > 0;
  } catch (error) {
    console.warn("[FlashSale] Appointment lookup skipped", error.message);
    return true;
  }
}

export function runFlashSaleCheck() {
  try {
    for (const scope of branchScopes()) {
      flashSaleRepo.expireOld(scope);
      for (const slot of candidateSlots()) {
        const params = { ...scope, ...slot };
        if (isBooked(params)) continue;
        if (flashSaleRepo.getActiveForSlot(params)) continue;
        const created = flashSaleRepo.create({
          ...params,
          discountPercent: FLASH_DISCOUNT,
          maxRedemptions: 3,
          expiresAt: Math.floor(Date.now() / 1000) + FLASH_DURATION_MINS * 60,
          triggerReason: "empty_slot"
        });
        console.log("[FlashSale] Created for slot", created.slotDate, created.slotTime, "branch", created.branchId);
      }
    }
  } catch (error) {
    console.warn("[FlashSale] Monitor skipped", error.message);
  }
}

setInterval(runFlashSaleCheck, CHECK_INTERVAL_MS);
runFlashSaleCheck();
