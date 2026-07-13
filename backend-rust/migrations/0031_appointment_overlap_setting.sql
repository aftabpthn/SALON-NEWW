ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_chair_room_no_overlap;

CREATE TABLE IF NOT EXISTS appointment_branch_settings (
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    allow_overlap BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, branch_id)
);
