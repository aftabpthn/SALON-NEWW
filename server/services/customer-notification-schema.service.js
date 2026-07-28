import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, "..", "db", "migrations", "20260728_customer_notifications.sql");
let ensured = false;

function migrateLegacyInboxRows() {
  db.prepare(`
    INSERT OR IGNORE INTO customerInboxNotifications
      (id, tenantId, branchId, customerId, type, category, title, body, data, deepLink,
       sourceType, sourceId, eventKey, pushNotificationId, scheduledAt, readAt, archivedAt, createdAt, updatedAt)
    SELECT
      'cin_' || n.id,
      c.tenantId,
      COALESCE(c.branchId, ''),
      n.clientId,
      COALESCE(NULLIF(n.type, ''), 'notification'),
      'transactional',
      CASE
        WHEN LOWER(COALESCE(n.type, '')) LIKE '%payment%' THEN 'Payment update'
        WHEN LOWER(COALESCE(n.type, '')) LIKE '%booking%' THEN 'Booking update'
        ELSE 'AuraSalon update'
      END,
      COALESCE(n.message, ''),
      '{}',
      '',
      'legacy_notification',
      n.id,
      'legacy:' || n.id,
      '',
      COALESCE(NULLIF(n.createdAt, ''), CURRENT_TIMESTAMP),
      CASE WHEN LOWER(COALESCE(n.status, '')) = 'read' THEN COALESCE(NULLIF(n.createdAt, ''), CURRENT_TIMESTAMP) ELSE '' END,
      '',
      COALESCE(NULLIF(n.createdAt, ''), CURRENT_TIMESTAMP),
      COALESCE(NULLIF(n.createdAt, ''), CURRENT_TIMESTAMP)
    FROM notifications n
    INNER JOIN clients c ON c.id = n.clientId
    WHERE COALESCE(n.clientId, '') != ''
  `).run();
}

export function ensureCustomerNotificationSchema() {
  if (ensured) return;
  db.exec(readFileSync(migrationPath, "utf8"));
  migrateLegacyInboxRows();
  ensured = true;
}
