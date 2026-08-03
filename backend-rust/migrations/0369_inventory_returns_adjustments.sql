ALTER TABLE pos_invoice_refund_lines
  ADD COLUMN IF NOT EXISTS restock_quantity BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discard_quantity BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_reference TEXT NOT NULL DEFAULT '';

UPDATE pos_invoice_refund_lines
SET restock_quantity = CASE WHEN restock_requested THEN quantity ELSE 0 END,
    discard_quantity = CASE WHEN restock_requested THEN 0 ELSE quantity END
WHERE restock_quantity + discard_quantity = 0;

ALTER TABLE pos_invoice_refund_lines
  DROP CONSTRAINT IF EXISTS pos_invoice_refund_lines_disposition_check;
ALTER TABLE pos_invoice_refund_lines
  ADD CONSTRAINT pos_invoice_refund_lines_disposition_check
  CHECK (restock_quantity >= 0 AND discard_quantity >= 0
         AND restock_quantity + discard_quantity = quantity);

ALTER TABLE purchase_returns
  ADD COLUMN IF NOT EXISTS return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS credit_note_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS credit_note_date DATE,
  ADD COLUMN IF NOT EXISTS evidence_reference TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_return_credit_note
  ON purchase_returns(tenant_id,branch_id,supplier_id,LOWER(credit_note_number))
  WHERE BTRIM(credit_note_number)<>'';

ALTER TABLE inventory_receiving_quarantine
  ADD COLUMN IF NOT EXISTS remaining_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS unit_cost_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_basis TEXT NOT NULL DEFAULT 'purchase_unit'
    CHECK (quantity_basis IN ('purchase_unit','base_unit'));

UPDATE inventory_receiving_quarantine quarantine
SET remaining_quantity = CASE WHEN quarantine.status='quarantined' THEN quarantine.quantity ELSE 0 END,
    unit_cost_paise = COALESCE(NULLIF(quarantine.unit_cost_paise,0),line.stock_unit_cost_paise)
FROM purchase_receipt_lines line
WHERE line.id=quarantine.purchase_receipt_line_id
  AND line.tenant_id=quarantine.tenant_id
  AND quarantine.remaining_quantity IS NULL;

ALTER TABLE inventory_receiving_quarantine
  ALTER COLUMN remaining_quantity SET NOT NULL,
  ALTER COLUMN remaining_quantity SET DEFAULT 0,
  DROP CONSTRAINT IF EXISTS inventory_receiving_quarantine_status_check;
ALTER TABLE inventory_receiving_quarantine
  ADD CONSTRAINT inventory_receiving_quarantine_status_check
    CHECK (status IN ('quarantined','partially_disposed','released','returned','discarded','mixed')),
  ADD CONSTRAINT inventory_receiving_quarantine_remaining_check
    CHECK (remaining_quantity BETWEEN 0 AND quantity);

CREATE TABLE IF NOT EXISTS inventory_quarantine_dispositions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  quarantine_id TEXT NOT NULL REFERENCES inventory_receiving_quarantine(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('release','return','discard')),
  quantity INTEGER NOT NULL CHECK (quantity>0),
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise>=0),
  reason TEXT NOT NULL CHECK (BTRIM(reason)<>''),
  evidence_reference TEXT NOT NULL CHECK (BTRIM(evidence_reference)<>''),
  credit_note_number TEXT NOT NULL DEFAULT '',
  stock_ledger_id TEXT REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL CHECK (BTRIM(actor_user_id)<>''),
  idempotency_key TEXT NOT NULL CHECK (BTRIM(idempotency_key)<>''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (action<>'return' OR BTRIM(credit_note_number)<>''),
  UNIQUE(tenant_id,branch_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_quarantine_dispositions_history
  ON inventory_quarantine_dispositions(tenant_id,branch_id,quarantine_id,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_adjustment_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  business_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','audit_reconciliation')),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','applied','rejected')),
  stock_before_quantity INTEGER NOT NULL,
  requested_stock_quantity INTEGER NOT NULL,
  quantity_delta INTEGER NOT NULL,
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise>=0),
  value_paise BIGINT NOT NULL CHECK (value_paise>=0),
  material BOOLEAN NOT NULL,
  reason TEXT NOT NULL CHECK (BTRIM(reason)<>''),
  evidence_reference TEXT NOT NULL CHECK (BTRIM(evidence_reference)<>''),
  requested_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  review_idempotency_key TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  adjustment_ledger_id TEXT REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (BTRIM(idempotency_key)<>''),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  CHECK (quantity_delta=requested_stock_quantity-stock_before_quantity),
  CHECK (value_paise=ABS(quantity_delta::BIGINT)*unit_cost_paise),
  CHECK (status<>'rejected' OR BTRIM(review_note)<>''),
  UNIQUE(tenant_id,branch_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_requests_history
  ON inventory_adjustment_requests(tenant_id,branch_id,inventory_item_id,requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_requests_pending
  ON inventory_adjustment_requests(tenant_id,branch_id,status,requested_at)
  WHERE status='pending_approval';
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_adjustment_review_key
  ON inventory_adjustment_requests(tenant_id,branch_id,review_idempotency_key)
  WHERE review_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_adjustment_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  adjustment_request_id TEXT NOT NULL REFERENCES inventory_adjustment_requests(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('requested','applied','approved','rejected')),
  actor_user_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_events_history
  ON inventory_adjustment_events(tenant_id,branch_id,adjustment_request_id,created_at,id);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS adjustment_request_id TEXT REFERENCES inventory_adjustment_requests(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quarantine_disposition_id TEXT REFERENCES inventory_quarantine_dispositions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS adjustment_source TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS adjustment_evidence_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS adjustment_business_date DATE;

ALTER TABLE inventory_stock_ledger
  DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN (
    'sale','return','purchase','purchase_return','transfer_out','transfer_in','transfer_reversal',
    'adjustment','consumption','kit_component_out','kit_assembly_in','kit_unbundle_out',
    'kit_component_in','opening_snapshot','quarantine_release'
  )) NOT VALID;

ALTER TABLE inventory_operational_movements
  DROP CONSTRAINT IF EXISTS inventory_operational_movements_action_check;
ALTER TABLE inventory_operational_movements
  ADD CONSTRAINT inventory_operational_movements_action_check CHECK (action IN (
    'manual_checkout','auto_retail_sale','auto_service_checkout','auto_transfer_checkout',
    'container_registered','container_opened','manual_consumption','conversion','reversal',
    'customer_return_restock','quarantine_release'
  ));

ALTER TABLE inventory_transfer_center_settings
  ADD COLUMN IF NOT EXISTS default_returns_warehouse_branch_id TEXT;
ALTER TABLE inventory_transfer_center_settings
  DROP CONSTRAINT IF EXISTS inventory_transfer_center_settings_returns_warehouse_check;
ALTER TABLE inventory_transfer_center_settings
  ADD CONSTRAINT inventory_transfer_center_settings_returns_warehouse_check
  CHECK (default_returns_warehouse_branch_id IS NULL OR default_returns_warehouse_branch_id<>branch_id);

WITH scopes AS (SELECT DISTINCT tenant_id,branch_id FROM inventory_items), defaults(code,label) AS (
  VALUES ('damage','Damaged'),('expiry','Expired'),('spill','Spill'),('shrinkage','Shrinkage'),
    ('theft','Theft'),('free-sample','Free Sample'),('customer-return-discard','Customer Return Discard')
)
INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,created_by)
SELECT scopes.tenant_id,scopes.branch_id,'adjustment_reason',defaults.code,defaults.label,'migration'
FROM scopes CROSS JOIN defaults ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_phase8_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'inventory return and adjustment history is append-only'
    USING ERRCODE='55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pos_refund_lines_append_only ON pos_invoice_refund_lines;
CREATE TRIGGER pos_refund_lines_append_only BEFORE UPDATE OR DELETE ON pos_invoice_refund_lines
FOR EACH ROW EXECUTE FUNCTION prevent_phase8_history_mutation();
DROP TRIGGER IF EXISTS purchase_returns_append_only ON purchase_returns;
CREATE TRIGGER purchase_returns_append_only BEFORE UPDATE OR DELETE ON purchase_returns
FOR EACH ROW EXECUTE FUNCTION prevent_phase8_history_mutation();
DROP TRIGGER IF EXISTS purchase_return_lines_append_only ON purchase_return_lines;
CREATE TRIGGER purchase_return_lines_append_only BEFORE UPDATE OR DELETE ON purchase_return_lines
FOR EACH ROW EXECUTE FUNCTION prevent_phase8_history_mutation();
DROP TRIGGER IF EXISTS quarantine_dispositions_append_only ON inventory_quarantine_dispositions;
CREATE TRIGGER quarantine_dispositions_append_only BEFORE UPDATE OR DELETE ON inventory_quarantine_dispositions
FOR EACH ROW EXECUTE FUNCTION prevent_phase8_history_mutation();
DROP TRIGGER IF EXISTS adjustment_events_append_only ON inventory_adjustment_events;
CREATE TRIGGER adjustment_events_append_only BEFORE UPDATE OR DELETE ON inventory_adjustment_events
FOR EACH ROW EXECUTE FUNCTION prevent_phase8_history_mutation();
