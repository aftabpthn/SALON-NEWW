ALTER TABLE integration_opening_inventory_snapshot_lines
  ADD COLUMN IF NOT EXISTS counted_by TEXT,
  ADD COLUMN IF NOT EXISTS count_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_quantity TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_unit TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_multiplier INTEGER NOT NULL DEFAULT 1 CHECK (unit_multiplier > 0),
  ADD COLUMN IF NOT EXISTS classifications_json JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(classifications_json) = 'object'),
  ADD CONSTRAINT opening_inventory_counted_by_required
    CHECK (counted_by IS NOT NULL) NOT VALID,
  ADD CONSTRAINT opening_inventory_classification_total_check CHECK (
    COALESCE((classifications_json->>'sellable')::INTEGER,0)
      + COALESCE((classifications_json->>'backbar')::INTEGER,0) = quantity
    AND COALESCE((classifications_json->>'damaged')::INTEGER,0) >= 0
    AND COALESCE((classifications_json->>'expired')::INTEGER,0) >= 0
    AND COALESCE((classifications_json->>'quarantined')::INTEGER,0) >= 0
    AND COALESCE((classifications_json->>'inTransit')::INTEGER,0) >= 0
  ) NOT VALID,
  ADD CONSTRAINT opening_inventory_counted_by_fk
    FOREIGN KEY (counted_by) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;

CREATE OR REPLACE FUNCTION reject_integration_migration_cutover_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_actor TEXT;
  v_role TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_DELETE_FORBIDDEN';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.cutover_date IS DISTINCT FROM OLD.cutover_date
     OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_IDENTITY_IMMUTABLE';
  END IF;

  IF OLD.status='live' AND (
       NEW.go_live_at IS DISTINCT FROM OLD.go_live_at
       OR NEW.inventory_freeze_end IS DISTINCT FROM OLD.inventory_freeze_end
       OR NEW.owner_approved_by IS DISTINCT FROM OLD.owner_approved_by
       OR NEW.owner_approved_at IS DISTINCT FROM OLD.owner_approved_at
     ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_GO_LIVE_AUDIT_IMMUTABLE';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_actor := NULLIF(CURRENT_SETTING('aurashine.cutover_actor_id', TRUE), '');
    v_role := LOWER(NULLIF(CURRENT_SETTING('aurashine.cutover_actor_role', TRUE), ''));
    IF v_actor IS NULL OR v_role IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_ACTOR_REQUIRED';
    END IF;
    IF NOT (
      (OLD.status='draft' AND NEW.status='history_importing') OR
      (OLD.status='history_importing' AND NEW.status='inventory_frozen') OR
      (OLD.status='inventory_frozen' AND NEW.status='snapshot_approved') OR
      (OLD.status='snapshot_approved' AND NEW.status='snapshot_applied') OR
      (OLD.status='snapshot_applied' AND NEW.status='reconciled') OR
      (OLD.status='reconciled' AND NEW.status='live')
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_TRANSITION_INVALID';
    END IF;
    IF NEW.status IN ('inventory_frozen','snapshot_approved','live')
       AND v_role NOT IN ('owner','superadmin','super-admin') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_OWNER_APPROVAL_REQUIRED';
    END IF;
    IF NEW.status='live' AND JSONB_ARRAY_LENGTH(migration_cutover_full_reconciliation(
      NEW.tenant_id::TEXT,NEW.branch_id::TEXT,NEW.id)->'blockers')>0 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_RECONCILIATION_BLOCKED';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
