ALTER TABLE integration_migration_cutovers
  ADD COLUMN IF NOT EXISTS business_timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS cutover_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS historical_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_freeze_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_freeze_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snapshot_checksum TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_users JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS owner_approved_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS owner_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS go_live_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rollback_state TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS configured_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE integration_migration_cutovers
SET cutover_at = COALESCE(cutover_at, cutover_date::TIMESTAMP AT TIME ZONE 'UTC'),
    historical_period_end = COALESCE(historical_period_end, cutover_date::TIMESTAMP AT TIME ZONE 'UTC'),
    configured_by = COALESCE(configured_by, created_by)
WHERE cutover_at IS NULL OR historical_period_end IS NULL OR configured_by IS NULL;

ALTER TABLE integration_migration_cutovers
  ALTER COLUMN cutover_at SET NOT NULL,
  ALTER COLUMN historical_period_end SET NOT NULL,
  ALTER COLUMN configured_by SET NOT NULL,
  ADD CONSTRAINT integration_migration_cutover_status_check CHECK (
    status IN ('draft','history_importing','inventory_frozen','snapshot_approved','snapshot_applied','reconciled','live')
  ),
  ADD CONSTRAINT integration_migration_cutover_rollback_state_check CHECK (
    rollback_state IN ('none','requested','completed','blocked')
  ),
  ADD CONSTRAINT integration_migration_cutover_time_order_check CHECK (
    historical_period_end <= cutover_at
    AND (inventory_freeze_end IS NULL OR inventory_freeze_start IS NOT NULL)
    AND (inventory_freeze_end IS NULL OR inventory_freeze_end >= inventory_freeze_start)
    AND (go_live_at IS NULL OR inventory_freeze_end IS NOT NULL)
  ),
  ADD CONSTRAINT integration_migration_cutover_snapshot_checksum_check CHECK (
    snapshot_checksum = '' OR snapshot_checksum ~ '^[0-9A-Fa-f]{64}$'
  ),
  ADD CONSTRAINT integration_migration_cutover_approved_users_check CHECK (
    JSONB_TYPEOF(approved_users) = 'array'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_migration_cutovers_active_branch
  ON integration_migration_cutovers(tenant_id, branch_id)
  WHERE status <> 'live' AND rollback_state <> 'completed';

CREATE TABLE IF NOT EXISTS integration_migration_cutover_transitions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  cutover_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, branch_id, cutover_id)
    REFERENCES integration_migration_cutovers(tenant_id, branch_id, id)
);

CREATE INDEX IF NOT EXISTS idx_integration_migration_cutover_transitions_scope
  ON integration_migration_cutover_transitions(tenant_id, branch_id, cutover_id, created_at, id);

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
    IF NEW.status IN ('inventory_frozen','live') AND v_role NOT IN ('owner','superadmin','super-admin') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_OWNER_APPROVAL_REQUIRED';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_integration_migration_cutover_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO integration_migration_cutover_transitions(
      tenant_id,branch_id,cutover_id,from_status,to_status,actor_id,actor_role,note
    ) VALUES (
      NEW.tenant_id,NEW.branch_id,NEW.id,NULL,NEW.status,NEW.created_by,
      COALESCE(NULLIF(CURRENT_SETTING('aurashine.cutover_actor_role', TRUE), ''),'system'),
      COALESCE(NULLIF(CURRENT_SETTING('aurashine.cutover_note', TRUE), ''),'cutover created')
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO integration_migration_cutover_transitions(
      tenant_id,branch_id,cutover_id,from_status,to_status,actor_id,actor_role,note
    ) VALUES (
      NEW.tenant_id,NEW.branch_id,NEW.id,OLD.status,NEW.status,
      CURRENT_SETTING('aurashine.cutover_actor_id'),
      CURRENT_SETTING('aurashine.cutover_actor_role'),
      COALESCE(NULLIF(CURRENT_SETTING('aurashine.cutover_note', TRUE), ''),'')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_integration_migration_cutover_immutable
  ON integration_migration_cutovers;
CREATE TRIGGER trg_integration_migration_cutover_immutable
BEFORE UPDATE OR DELETE ON integration_migration_cutovers
FOR EACH ROW EXECUTE FUNCTION reject_integration_migration_cutover_mutation();

DROP TRIGGER IF EXISTS trg_integration_migration_cutover_audit
  ON integration_migration_cutovers;
CREATE TRIGGER trg_integration_migration_cutover_audit
AFTER INSERT OR UPDATE OF status ON integration_migration_cutovers
FOR EACH ROW EXECUTE FUNCTION audit_integration_migration_cutover_transition();

CREATE OR REPLACE FUNCTION reject_integration_migration_cutover_transition_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MIGRATION_CUTOVER_AUDIT_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_integration_migration_cutover_transition_immutable
  ON integration_migration_cutover_transitions;
CREATE TRIGGER trg_integration_migration_cutover_transition_immutable
BEFORE UPDATE OR DELETE ON integration_migration_cutover_transitions
FOR EACH ROW EXECUTE FUNCTION reject_integration_migration_cutover_transition_mutation();

CREATE OR REPLACE FUNCTION assert_inventory_cutover_allows_stock_write(
  p_tenant_id TEXT,
  p_branch_id TEXT
) RETURNS VOID AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM integration_migration_cutovers
  WHERE tenant_id::TEXT=p_tenant_id
    AND branch_id::TEXT=p_branch_id
    AND status IN ('inventory_frozen','snapshot_approved','snapshot_applied','reconciled')
    AND rollback_state <> 'completed'
  ORDER BY created_at DESC
  LIMIT 1
  FOR SHARE;

  IF v_status IS NOT NULL AND NOT (
    v_status='snapshot_approved'
    AND CURRENT_SETTING('aurashine.cutover_snapshot_apply', TRUE)='on'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='INVENTORY_CUTOVER_FROZEN';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_inventory_item_cutover_write()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.stock_quantity <> 0)
     OR (TG_OP='UPDATE' AND NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity) THEN
    PERFORM assert_inventory_cutover_allows_stock_write(NEW.tenant_id, NEW.branch_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_inventory_ledger_cutover_write()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_inventory_cutover_allows_stock_write(NEW.tenant_id, NEW.branch_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_items_cutover_guard ON inventory_items;
CREATE TRIGGER trg_inventory_items_cutover_guard
BEFORE INSERT OR UPDATE OF stock_quantity ON inventory_items
FOR EACH ROW EXECUTE FUNCTION guard_inventory_item_cutover_write();

DROP TRIGGER IF EXISTS trg_inventory_stock_ledger_cutover_guard ON inventory_stock_ledger;
CREATE TRIGGER trg_inventory_stock_ledger_cutover_guard
BEFORE INSERT ON inventory_stock_ledger
FOR EACH ROW EXECUTE FUNCTION guard_inventory_ledger_cutover_write();
