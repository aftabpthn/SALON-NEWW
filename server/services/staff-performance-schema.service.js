import { db } from "../db.js";

let ensured = false;

export function ensureStaffPerformanceSchema() {
  if (ensured) return;
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_appointments_staff_start ON appointments(staffId, startAt);
    CREATE INDEX IF NOT EXISTS idx_appointments_tenant_start ON appointments(tenantId, startAt);
    CREATE INDEX IF NOT EXISTS idx_staff_attendance_logs_staff_date ON staff_attendance_logs(tenant_id, staff_id, business_date);
    CREATE INDEX IF NOT EXISTS idx_staff_breaks_attendance ON staff_breaks(attendance_id);
    CREATE INDEX IF NOT EXISTS idx_staff_targets_staff_period ON staff_targets(tenant_id, staff_id, period_start, period_end);
    CREATE INDEX IF NOT EXISTS idx_appointment_activity_log_appointment ON appointment_activity_log(appointmentId);
    CREATE INDEX IF NOT EXISTS idx_sales_appointment ON sales(appointmentId);
    CREATE INDEX IF NOT EXISTS idx_invoices_sale ON invoices(saleId);
  `);
  ensured = true;
}
