ALTER TABLE inventory_backbar_usage
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reversal_idempotency_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_backbar_usage_reversal_key
  ON inventory_backbar_usage(tenant_id,branch_id,reversal_idempotency_key)
  WHERE reversal_idempotency_key<>'';

ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_status_check;
ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_status_check
  CHECK (status IN ('recorded','pending_approval','rejected','reversed')) NOT VALID;

ALTER TABLE inventory_backbar_container_events
  DROP CONSTRAINT IF EXISTS inventory_backbar_container_events_event_type_check;
ALTER TABLE inventory_backbar_container_events
  ADD CONSTRAINT inventory_backbar_container_events_event_type_check
  CHECK (event_type IN (
    'created','opened','consumed','closed','premature_open_blocked',
    'override_requested','override_approved','override_rejected',
    'custody_transferred','floor_count_adjusted','usage_reversed'
  )) NOT VALID;

CREATE TABLE IF NOT EXISTS appointment_service_recipe_snapshots (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  recipe_version_id TEXT REFERENCES service_recipe_versions(id) ON DELETE RESTRICT,
  recipe_version_number INTEGER NOT NULL DEFAULT 0 CHECK (recipe_version_number >= 0),
  recipe_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(recipe_json)='array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,appointment_id,service_id)
);
CREATE INDEX IF NOT EXISTS idx_appointment_recipe_snapshot_service
  ON appointment_service_recipe_snapshots(tenant_id,branch_id,service_id,created_at DESC);

CREATE OR REPLACE FUNCTION snapshot_appointment_service_recipes()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM appointment_service_recipe_snapshots snapshot
  WHERE snapshot.tenant_id=NEW.tenant_id AND snapshot.branch_id=NEW.branch_id
    AND snapshot.appointment_id=NEW.id
    AND NOT (COALESCE(NULLIF(NEW.service_ids_json,''),'[]')::JSONB ? snapshot.service_id);

  INSERT INTO appointment_service_recipe_snapshots(
    tenant_id,branch_id,appointment_id,service_id,recipe_version_id,
    recipe_version_number,recipe_json
  )
  SELECT NEW.tenant_id,NEW.branch_id,NEW.id,service.id,
         version.id,COALESCE(version.version_number,0),
         COALESCE(version.recipe_json,service.product_consumption_json,'[]'::JSONB)
  FROM jsonb_array_elements_text(COALESCE(NULLIF(NEW.service_ids_json,''),'[]')::JSONB) selected(service_id)
  JOIN services service ON service.tenant_id=NEW.tenant_id
    AND service.branch_id=NEW.branch_id AND service.id=selected.service_id
  LEFT JOIN LATERAL (
    SELECT recipe.id,recipe.version_number,recipe.recipe_json
    FROM service_recipe_versions recipe
    WHERE recipe.tenant_id=service.tenant_id AND recipe.branch_id=service.branch_id
      AND recipe.service_id=service.id
    ORDER BY recipe.version_number DESC LIMIT 1
  ) version ON TRUE
  ON CONFLICT (tenant_id,branch_id,appointment_id,service_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_appointment_service_recipes ON appointments;
CREATE TRIGGER trg_snapshot_appointment_service_recipes
AFTER INSERT OR UPDATE OF service_ids_json ON appointments
FOR EACH ROW EXECUTE FUNCTION snapshot_appointment_service_recipes();

INSERT INTO appointment_service_recipe_snapshots(
  tenant_id,branch_id,appointment_id,service_id,recipe_version_id,
  recipe_version_number,recipe_json
)
SELECT appointment.tenant_id,appointment.branch_id,appointment.id,service.id,
       version.id,COALESCE(version.version_number,0),
       COALESCE(version.recipe_json,service.product_consumption_json,'[]'::JSONB)
FROM appointments appointment
CROSS JOIN LATERAL jsonb_array_elements_text(
  COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB
) selected(service_id)
JOIN services service ON service.tenant_id=appointment.tenant_id
  AND service.branch_id=appointment.branch_id AND service.id=selected.service_id
LEFT JOIN LATERAL (
  SELECT recipe.id,recipe.version_number,recipe.recipe_json
  FROM service_recipe_versions recipe
  WHERE recipe.tenant_id=service.tenant_id AND recipe.branch_id=service.branch_id
    AND recipe.service_id=service.id
  ORDER BY recipe.version_number DESC LIMIT 1
) version ON TRUE
ON CONFLICT (tenant_id,branch_id,appointment_id,service_id) DO NOTHING;
