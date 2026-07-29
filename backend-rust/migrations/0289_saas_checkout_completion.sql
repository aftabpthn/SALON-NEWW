ALTER TABLE saas_checkout_requests
  DROP CONSTRAINT IF EXISTS saas_checkout_requests_status_check;
ALTER TABLE saas_checkout_requests
  ADD CONSTRAINT saas_checkout_requests_status_check
  CHECK (status IN ('creating','ready','completed','failed'));
