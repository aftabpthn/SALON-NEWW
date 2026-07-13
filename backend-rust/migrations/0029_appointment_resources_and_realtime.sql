CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS appointment_resources (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'chair',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, branch_id, name)
);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS chair_room_id TEXT REFERENCES appointment_resources(id);
CREATE INDEX IF NOT EXISTS idx_appointments_resource_schedule
    ON appointments (tenant_id, branch_id, chair_room_id, start_at)
    WHERE chair_room_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_chair_room_no_overlap') THEN
        ALTER TABLE appointments
            ADD CONSTRAINT appointments_chair_room_no_overlap
            EXCLUDE USING gist (
                tenant_id WITH =,
                branch_id WITH =,
                chair_room_id WITH =,
                tstzrange(start_at, end_at, '[)') WITH &&
            )
            WHERE (chair_room_id IS NOT NULL AND status NOT IN ('cancelled', 'no-show'));
    END IF;
END $$;
