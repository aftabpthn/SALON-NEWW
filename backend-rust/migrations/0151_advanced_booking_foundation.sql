ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS booking_deposit_percent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE branches DROP CONSTRAINT IF EXISTS ck_branches_latitude;
ALTER TABLE branches ADD CONSTRAINT ck_branches_latitude
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE branches DROP CONSTRAINT IF EXISTS ck_branches_longitude;
ALTER TABLE branches ADD CONSTRAINT ck_branches_longitude
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE branches DROP CONSTRAINT IF EXISTS ck_branches_booking_deposit_percent;
ALTER TABLE branches ADD CONSTRAINT ck_branches_booking_deposit_percent
  CHECK (booking_deposit_percent BETWEEN 0 AND 100);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS recurrence_series_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS service_selections_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_appointments_recurrence_series
  ON appointments (tenant_id, branch_id, recurrence_series_id, start_at)
  WHERE recurrence_series_id <> '';

CREATE OR REPLACE FUNCTION capture_appointment_booked_service_prices()
RETURNS TRIGGER AS $$
DECLARE
  previous_service_ids JSONB := '[]'::jsonb;
  previous_prices JSONB := '{}'::jsonb;
  previous_selections JSONB := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_service_ids := COALESCE(NULLIF(OLD.service_ids_json, ''), '[]')::jsonb;
    previous_prices := COALESCE(OLD.booked_service_prices_json, '{}'::jsonb);
    previous_selections := COALESCE(OLD.service_selections_json, '{}'::jsonb);
  END IF;

  SELECT COALESCE(
           jsonb_object_agg(priced.service_id, to_jsonb(priced.price_paise)),
           '{}'::jsonb
         )
    INTO NEW.booked_service_prices_json
    FROM (
      SELECT requested.service_id,
             CASE
               WHEN TG_OP = 'UPDATE'
                AND previous_service_ids ? requested.service_id
                AND COALESCE(previous_selections -> requested.service_id, '{}'::jsonb)
                    = COALESCE(NEW.service_selections_json -> requested.service_id, '{}'::jsonb)
                 THEN COALESCE((previous_prices ->> requested.service_id)::BIGINT, 0)
               ELSE GREATEST(
                 0,
                 priced_base.subtotal_paise
                   + ROUND(priced_base.subtotal_paise * COALESCE(rule.adjustment_bps, 0) / 10000.0)::BIGINT
                   + COALESCE(addons.total_paise, 0)
               )
             END AS price_paise
        FROM jsonb_array_elements_text(
               COALESCE(NULLIF(NEW.service_ids_json, ''), '[]')::jsonb
             ) AS requested(service_id)
        JOIN services service
          ON service.id = requested.service_id
         AND service.tenant_id = NEW.tenant_id
         AND service.branch_id = NEW.branch_id
        LEFT JOIN service_staff_prices staff_price
          ON staff_price.tenant_id = NEW.tenant_id
         AND staff_price.branch_id = NEW.branch_id
         AND staff_price.service_id = requested.service_id
         AND staff_price.staff_id = NEW.staff_id
         AND staff_price.active = TRUE
        LEFT JOIN service_variants variant
          ON variant.tenant_id = NEW.tenant_id
         AND variant.branch_id = NEW.branch_id
         AND variant.service_id = requested.service_id
         AND variant.id = NULLIF(NEW.service_selections_json -> requested.service_id ->> 'variantId', '')
         AND variant.active = TRUE
        CROSS JOIN LATERAL (
          SELECT GREATEST(
                   0,
                   COALESCE(staff_price.price_paise, service.price_paise)
                     + COALESCE(variant.price_delta_paise, 0)
                 )::BIGINT AS subtotal_paise
        ) priced_base
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(addon.price_paise), 0)::BIGINT AS total_paise
            FROM service_addons addon
           WHERE addon.tenant_id = NEW.tenant_id
             AND addon.branch_id = NEW.branch_id
             AND addon.service_id = requested.service_id
             AND addon.active = TRUE
             AND addon.id IN (
               SELECT jsonb_array_elements_text(
                 COALESCE(NEW.service_selections_json -> requested.service_id -> 'addonIds', '[]'::jsonb)
               )
             )
        ) addons ON TRUE
        LEFT JOIN LATERAL (
          SELECT price_rule.adjustment_bps
            FROM service_price_rules price_rule
           WHERE price_rule.tenant_id = NEW.tenant_id
             AND price_rule.branch_id = NEW.branch_id
             AND price_rule.service_id = requested.service_id
             AND price_rule.active = TRUE
             AND EXTRACT(DOW FROM NEW.start_at AT TIME ZONE 'Asia/Kolkata')::SMALLINT
                 = ANY(price_rule.days_of_week)
             AND (
               (price_rule.start_time < price_rule.end_time
                 AND (NEW.start_at AT TIME ZONE 'Asia/Kolkata')::TIME >= price_rule.start_time
                 AND (NEW.start_at AT TIME ZONE 'Asia/Kolkata')::TIME < price_rule.end_time)
               OR
               (price_rule.start_time > price_rule.end_time
                 AND ((NEW.start_at AT TIME ZONE 'Asia/Kolkata')::TIME >= price_rule.start_time
                   OR (NEW.start_at AT TIME ZONE 'Asia/Kolkata')::TIME < price_rule.end_time))
             )
           ORDER BY price_rule.priority DESC, price_rule.created_at, price_rule.id
           LIMIT 1
        ) rule ON TRUE
       WHERE BTRIM(requested.service_id) <> ''
    ) priced;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_booked_service_prices ON appointments;
CREATE TRIGGER appointments_booked_service_prices
BEFORE INSERT OR UPDATE OF service_ids_json, service_selections_json
ON appointments
FOR EACH ROW
EXECUTE FUNCTION capture_appointment_booked_service_prices();
