import { db } from "../db.js";
import { ensureCustomerCareAiSchema } from "./customer-care-ai-schema.service.js";

let ensured = false;

export function ensureCustomerBookingSupportSchema() {
  if (ensured) return;
  ensureCustomerCareAiSchema();

  const columns = new Set(db.prepare("PRAGMA table_info(customerCareAiTickets)").all().map((column) => column.name));
  const run = db.transaction(() => {
    if (!columns.has("bookingId")) {
      db.prepare("ALTER TABLE customerCareAiTickets ADD COLUMN bookingId TEXT NOT NULL DEFAULT ''").run();
    }
    db.prepare("CREATE INDEX IF NOT EXISTS idx_customerCareAiTickets_booking_support ON customerCareAiTickets(tenantId, customerId, bookingId, updatedAt)").run();
  });
  run();
  ensured = true;
}

ensureCustomerBookingSupportSchema();
