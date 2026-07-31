ALTER TABLE appointment_waitlist
    ADD COLUMN IF NOT EXISTS constraint_type TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS constraint_resource_kind TEXT NOT NULL DEFAULT '';

ALTER TABLE appointment_waitlist DROP CONSTRAINT IF EXISTS appointment_waitlist_constraint_type_check;
ALTER TABLE appointment_waitlist ADD CONSTRAINT appointment_waitlist_constraint_type_check
    CHECK (constraint_type IN ('none', 'resource_unavailable', 'capacity_full', 'equipment_maintenance'));

ALTER TABLE appointment_waitlist DROP CONSTRAINT IF EXISTS appointment_waitlist_constraint_resource_kind_check;
ALTER TABLE appointment_waitlist ADD CONSTRAINT appointment_waitlist_constraint_resource_kind_check
    CHECK (constraint_resource_kind IN ('', 'chair', 'room', 'workstation'));

UPDATE appointment_waitlist
SET constraint_type = 'resource_unavailable'
WHERE constraint_type = 'none'
  AND LOWER(COALESCE(notes, '')) ~ '(chair|room|resource|equipment|capacity)';

CREATE INDEX IF NOT EXISTS idx_appointment_waitlist_constraints
    ON appointment_waitlist (tenant_id, branch_id, constraint_type, status, preferred_slot_at)
    WHERE constraint_type <> 'none';
