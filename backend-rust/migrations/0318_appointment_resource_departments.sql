ALTER TABLE appointment_resources
    ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_appointment_resources_department
    ON appointment_resources (tenant_id, branch_id, department)
    WHERE active = TRUE;
