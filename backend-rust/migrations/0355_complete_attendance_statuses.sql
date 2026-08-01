ALTER TABLE staff_attendance_records
  DROP CONSTRAINT IF EXISTS staff_attendance_records_status_check,
  DROP CONSTRAINT IF EXISTS staff_attendance_records_manual_status_check;

ALTER TABLE staff_attendance_records
  ADD CONSTRAINT staff_attendance_records_status_check
    CHECK (status IN ('clocked_in','clocked_out','present','absent','late','half_day','leave','special_leave','weekly_off','holiday')),
  ADD CONSTRAINT staff_attendance_records_manual_status_check
    CHECK (manual_status IS NULL OR manual_status IN ('present','absent','late','half_day','leave','special_leave','weekly_off','holiday'));
