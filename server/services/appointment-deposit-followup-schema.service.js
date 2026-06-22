import { db } from "../db.js";

let ensured = false;

export function ensureAppointmentDepositFollowupSchema() {
  if (ensured) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_deposit_followups (
      paymentLinkId TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT DEFAULT '',
      appointmentId TEXT DEFAULT '',
      invoiceId TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reminderChannel TEXT DEFAULT '',
      reminderSentAt TEXT DEFAULT '',
      doneAt TEXT DEFAULT '',
      note TEXT DEFAULT '',
      actorUserId TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  db.prepare("CREATE INDEX IF NOT EXISTS idx_appointment_deposit_followups_scope ON appointment_deposit_followups(tenantId, branchId, status, updatedAt)").run();
  ensured = true;
}
