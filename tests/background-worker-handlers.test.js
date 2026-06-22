import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const jobWorker = readFileSync("server/workers/job-worker.js", "utf8");

const handlers = {
  abandonedRecovery: readFileSync("server/workers/handlers/abandoned-recovery.handler.js", "utf8"),
  emailSend: readFileSync("server/workers/handlers/email-send.handler.js", "utf8"),
  calendarSync: readFileSync("server/workers/handlers/calendar-sync.handler.js", "utf8"),
  inventoryDeduct: readFileSync("server/workers/handlers/inventory-deduct.handler.js", "utf8"),
  loyaltyCredit: readFileSync("server/workers/handlers/loyalty-credit.handler.js", "utf8")
};

test("background worker maps the production job types to concrete handlers", () => {
  for (const jobType of [
    "abandoned-recovery",
    "email-send",
    "calendar-sync",
    "inventory-deduct",
    "loyalty-credit"
  ]) {
    assert.match(jobWorker, new RegExp(`"${jobType}"`), `${jobType} should be registered in job-worker`);
  }
});

test("background job handlers no longer return queued placeholders", () => {
  for (const [name, source] of Object.entries(handlers)) {
    assert.ok(!source.includes("queued-placeholder"), `${name} should not return queued-placeholder`);
    assert.match(source, /export async function run\(job\)/, `${name} should process the job payload`);
  }
});

test("background job handlers are wired to real persistence or domain services", () => {
  assert.match(handlers.abandonedRecovery, /sendWhatsapp\(/, "abandoned recovery should dispatch through WhatsApp worker");
  assert.match(handlers.abandonedRecovery, /UPDATE booking_abandonments[\s\S]*message_sent/, "abandoned recovery should update recovery state");

  assert.match(handlers.emailSend, /INSERT INTO notifications/, "email send should queue a notification row");
  assert.match(handlers.emailSend, /email\.queued/, "email send should audit queued email work");
  assert.match(handlers.emailSend, /scopedById\("invoices"/, "email send should tolerate legacy and enterprise invoice schemas");

  assert.match(handlers.calendarSync, /UPDATE marketplace_connections/, "calendar sync should update connection health");
  assert.match(handlers.calendarSync, /calendar\.synced/, "calendar sync should audit sync work");

  assert.match(handlers.inventoryDeduct, /deductServiceUsage/, "inventory deduct should use service recipe consumption");
  assert.match(handlers.inventoryDeduct, /applyInventoryDelta/, "inventory deduct should support direct product deduction");

  assert.match(handlers.loyaltyCredit, /loyaltyService\.transact/, "loyalty credit should create a loyalty transaction");
  assert.match(handlers.loyaltyCredit, /UPDATE clients[\s\S]*loyaltyPoints/, "loyalty credit should sync client balance");
});
