CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_staff_start
  ON appointments (tenant_id, branch_id, staff_id, start_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_client_start
  ON appointments (tenant_id, branch_id, client_id, start_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_status_updated
  ON appointments (tenant_id, branch_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_booking_group
  ON appointments (tenant_id, branch_id, booking_group_id, start_at)
  WHERE booking_group_id <> '';

CREATE INDEX IF NOT EXISTS idx_appointment_activity_tenant_appointment_created
  ON appointment_activity (tenant_id, appointment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_sales_tenant_branch_client_created
  ON pos_sales (tenant_id, branch_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_sales_tenant_branch_staff_created
  ON pos_sales (tenant_id, branch_id, staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_sales_tenant_branch_status_created
  ON pos_sales (tenant_id, branch_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_sales_tenant_branch_reference
  ON pos_sales (tenant_id, branch_id, reference_id)
  WHERE reference_id <> '';

CREATE INDEX IF NOT EXISTS idx_pos_invoice_events_tenant_branch_created
  ON pos_invoice_events (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_action_history_tenant_branch_created
  ON pos_invoice_action_history (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_due_recovery_followups_tenant_branch_sale_created
  ON due_recovery_followups (tenant_id, branch_id, sale_id, created_at DESC);
