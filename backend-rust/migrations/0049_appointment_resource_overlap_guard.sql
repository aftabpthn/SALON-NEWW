-- Enforce chair/room availability at the database boundary while preserving
-- the tenant and branch-level allow_overlap setting.
CREATE OR REPLACE FUNCTION enforce_appointment_resource_overlap()
RETURNS TRIGGER AS $$
DECLARE
    overlap_allowed BOOLEAN := FALSE;
BEGIN
    IF NEW.chair_room_id IS NULL
       OR NEW.status IN ('cancelled', 'no-show') THEN
        RETURN NEW;
    END IF;

    SELECT allow_overlap
      INTO overlap_allowed
      FROM appointment_branch_settings
     WHERE tenant_id = NEW.tenant_id
       AND branch_id = NEW.branch_id;

    IF COALESCE(overlap_allowed, FALSE) THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM appointments existing
         WHERE existing.tenant_id = NEW.tenant_id
           AND existing.branch_id = NEW.branch_id
           AND existing.chair_room_id = NEW.chair_room_id
           AND existing.id <> NEW.id
           AND existing.status NOT IN ('cancelled', 'no-show')
           AND existing.start_at < NEW.end_at
           AND existing.end_at > NEW.start_at
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23P01',
            MESSAGE = 'chair or room is already booked for this time';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_resource_overlap_guard ON appointments;

CREATE TRIGGER appointments_resource_overlap_guard
BEFORE INSERT OR UPDATE OF chair_room_id, start_at, end_at, status
ON appointments
FOR EACH ROW
EXECUTE FUNCTION enforce_appointment_resource_overlap();
