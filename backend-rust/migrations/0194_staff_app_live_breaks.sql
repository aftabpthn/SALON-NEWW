ALTER TABLE staff_attendance_breaks
  ALTER COLUMN ended_at DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_attendance_active_break
  ON staff_attendance_breaks(attendance_id)
  WHERE ended_at IS NULL;
