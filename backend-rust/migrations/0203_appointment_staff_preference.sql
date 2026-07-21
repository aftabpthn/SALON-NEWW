ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS requested_staff_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS staff_preference TEXT NOT NULL DEFAULT 'any';

ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS appointments_staff_preference_check;

ALTER TABLE appointments
    ADD CONSTRAINT appointments_staff_preference_check
    CHECK (staff_preference IN ('any', 'preferred', 'required'));
