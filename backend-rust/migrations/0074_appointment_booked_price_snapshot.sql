ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS booked_service_prices_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Capture catalogue prices at the appointment write boundary so every booking
-- path shares the same rule. Existing appointments remain empty because the
-- current catalogue cannot be treated as historical booking truth.
CREATE OR REPLACE FUNCTION capture_appointment_booked_service_prices()
RETURNS TRIGGER AS $$
DECLARE
  previous_service_ids JSONB := '[]'::jsonb;
  previous_prices JSONB := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_service_ids := COALESCE(NULLIF(OLD.service_ids_json, ''), '[]')::jsonb;
    previous_prices := COALESCE(OLD.booked_service_prices_json, '{}'::jsonb);
  END IF;

  SELECT COALESCE(
           jsonb_object_agg(priced.service_id, priced.price_json)
             FILTER (WHERE priced.price_json IS NOT NULL),
           '{}'::jsonb
         )
    INTO NEW.booked_service_prices_json
    FROM (
      SELECT requested.service_id,
             CASE
               WHEN TG_OP = 'UPDATE'
                AND previous_service_ids ? requested.service_id
                 THEN previous_prices -> requested.service_id
               ELSE to_jsonb(service.price_paise::BIGINT)
             END AS price_json
        FROM jsonb_array_elements_text(
               COALESCE(NULLIF(NEW.service_ids_json, ''), '[]')::jsonb
             ) AS requested(service_id)
        LEFT JOIN services service
          ON service.id = requested.service_id
         AND service.tenant_id = NEW.tenant_id
         AND service.branch_id = NEW.branch_id
       WHERE BTRIM(requested.service_id) <> ''
    ) priced;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_booked_service_prices ON appointments;

CREATE TRIGGER appointments_booked_service_prices
BEFORE INSERT OR UPDATE OF service_ids_json
ON appointments
FOR EACH ROW
EXECUTE FUNCTION capture_appointment_booked_service_prices();
