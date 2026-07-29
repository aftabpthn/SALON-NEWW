ALTER TABLE staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_status_check;

ALTER TABLE staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_status_check
  CHECK (status IN ('pending','approved','rejected','withdrawn'));
