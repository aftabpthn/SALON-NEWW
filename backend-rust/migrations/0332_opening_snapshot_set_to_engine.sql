ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS opening_snapshot_id TEXT
    REFERENCES integration_opening_inventory_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS opening_snapshot_line_id TEXT
    REFERENCES integration_opening_inventory_snapshot_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inventory_location_code TEXT;

ALTER TABLE inventory_stock_ledger
  DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN (
    'sale', 'return', 'purchase', 'purchase_return',
    'transfer_out', 'transfer_in', 'transfer_reversal',
    'adjustment', 'consumption', 'kit_component_out', 'kit_assembly_in',
    'opening_snapshot'
  )) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_opening_snapshot_line
  ON inventory_stock_ledger(tenant_id, branch_id, opening_snapshot_line_id)
  WHERE opening_snapshot_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_cutover_location
  ON inventory_stock_ledger(
    tenant_id, branch_id, inventory_item_id, inventory_location_code, created_at
  );

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
    (v_status='snapshot_approved'
      AND CURRENT_SETTING('aurashine.cutover_snapshot_apply', TRUE)='on')
    OR
    (v_status='snapshot_applied'
      AND CURRENT_SETTING('aurashine.cutover_snapshot_rollback', TRUE)='on')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='INVENTORY_CUTOVER_FROZEN';
  END IF;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE integration_opening_inventory_snapshot_lines
  ADD COLUMN IF NOT EXISTS post_cutover_delta INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_delta INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS integration_opening_inventory_batch_applications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  snapshot_line_id TEXT NOT NULL
    REFERENCES integration_opening_inventory_snapshot_lines(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_code TEXT NOT NULL CHECK (BTRIM(location_code) <> ''),
  batch_number TEXT NOT NULL CHECK (BTRIM(batch_number) <> ''),
  declared_quantity INTEGER NOT NULL,
  post_cutover_delta INTEGER NOT NULL,
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key),
  UNIQUE (snapshot_line_id, batch_number)
);

DROP TRIGGER IF EXISTS trg_opening_inventory_batch_applications_immutable
  ON integration_opening_inventory_batch_applications;
CREATE TRIGGER trg_opening_inventory_batch_applications_immutable
BEFORE UPDATE OR DELETE ON integration_opening_inventory_batch_applications
FOR EACH ROW EXECUTE FUNCTION reject_opening_inventory_snapshot_evidence_mutation();
