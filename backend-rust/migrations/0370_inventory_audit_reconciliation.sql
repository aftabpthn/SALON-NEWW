ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS allow_zero_unaudited_audit BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE stock_count_sessions
  ADD COLUMN IF NOT EXISTS business_date DATE,
  ADD COLUMN IF NOT EXISTS audit_scope TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS product_scope TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS unaudited_policy TEXT NOT NULL DEFAULT 'require_count',
  ADD COLUMN IF NOT EXISTS current_round INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reconciled_by TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_ledger_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_closing_id TEXT REFERENCES inventory_floor_closings(id) ON DELETE RESTRICT;

UPDATE stock_count_sessions
SET business_date=(cutoff_at AT TIME ZONE 'Asia/Kolkata')::DATE
WHERE business_date IS NULL;

ALTER TABLE stock_count_sessions ALTER COLUMN business_date SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_count_sessions_phase9_scope_check') THEN
    ALTER TABLE stock_count_sessions ADD CONSTRAINT stock_count_sessions_phase9_scope_check CHECK (
      audit_scope IN ('full','cycle')
      AND product_scope IN ('all','retail','consumable')
      AND unaudited_policy IN ('require_count','counted_only','projected_floor_zero','projected_preserve_negative','zero')
      AND current_round BETWEEN 1 AND 10
    );
  END IF;
END $$;

ALTER TABLE stock_count_session_items
  DROP CONSTRAINT IF EXISTS stock_count_session_items_expected_quantity_check;

ALTER TABLE stock_count_session_items
  ADD COLUMN IF NOT EXISTS audit_source TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS included_in_reconciliation BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reconciliation_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reconciled_source_ledger_id TEXT REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reconciled_stock_quantity INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_count_session_items_audit_source_check') THEN
    ALTER TABLE stock_count_session_items ADD CONSTRAINT stock_count_session_items_audit_source_check
      CHECK (audit_source IN ('pending','manual','projected','zero','excluded'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stock_count_session_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES stock_count_sessions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created','counting_closed','recount_required','reconciliation_saved','submitted',
    'approved','rejected','resubmitted','posted','csv_imported'
  )),
  actor_user_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_count_session_events_history
  ON stock_count_session_events(tenant_id,branch_id,session_id,created_at,id);

CREATE INDEX IF NOT EXISTS idx_stock_count_sessions_open_scope
  ON stock_count_sessions(tenant_id,branch_id,product_scope,status,created_at DESC)
  WHERE status IN ('counting','recount_required','review','pending_approval','approved');

CREATE OR REPLACE FUNCTION protect_stock_count_item_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'stock audit snapshot rows are immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.inventory_item_id IS DISTINCT FROM OLD.inventory_item_id
     OR NEW.expected_quantity IS DISTINCT FROM OLD.expected_quantity
     OR NEW.expected_unit_cost_paise IS DISTINCT FROM OLD.expected_unit_cost_paise
     OR NEW.expected_source_ledger_id IS DISTINCT FROM OLD.expected_source_ledger_id
     OR NEW.expected_ledger_movement_count IS DISTINCT FROM OLD.expected_ledger_movement_count
     OR NEW.expected_provenance_status IS DISTINCT FROM OLD.expected_provenance_status
     OR NEW.expected_movement_summary IS DISTINCT FROM OLD.expected_movement_summary THEN
    RAISE EXCEPTION 'stock audit expected snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_count_session_items_snapshot_immutable ON stock_count_session_items;
CREATE TRIGGER stock_count_session_items_snapshot_immutable
BEFORE UPDATE OR DELETE ON stock_count_session_items
FOR EACH ROW EXECUTE FUNCTION protect_stock_count_item_snapshot();

CREATE OR REPLACE FUNCTION prevent_stock_audit_session_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stock audit sessions and history are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_count_sessions_no_delete ON stock_count_sessions;
CREATE TRIGGER stock_count_sessions_no_delete
BEFORE DELETE ON stock_count_sessions
FOR EACH ROW EXECUTE FUNCTION prevent_stock_audit_session_delete();

DROP TRIGGER IF EXISTS stock_count_session_events_immutable ON stock_count_session_events;
CREATE TRIGGER stock_count_session_events_immutable
BEFORE UPDATE OR DELETE ON stock_count_session_events
FOR EACH ROW EXECUTE FUNCTION prevent_stock_audit_event_mutation();
