CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sales_appointment_reference
  ON pos_sales (tenant_id, branch_id, source, reference_id)
  WHERE source = 'appointment' AND reference_id <> '';
