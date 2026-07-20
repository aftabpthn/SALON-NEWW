ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft','pending_approval','approved','rejected','partially_received','received','cancelled','closed'));

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS purchase_order_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (BTRIM(event_type) <> ''),
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_events_scope
  ON purchase_order_events (tenant_id, branch_id, purchase_order_id, created_at DESC);

INSERT INTO purchase_order_events
  (tenant_id, branch_id, purchase_order_id, event_type, to_status, actor_user_id, created_at)
SELECT tenant_id, branch_id, id, 'created', 'draft', created_by, created_at
FROM purchase_orders order_row
WHERE NOT EXISTS (
  SELECT 1 FROM purchase_order_events event
  WHERE event.tenant_id=order_row.tenant_id
    AND event.branch_id=order_row.branch_id
    AND event.purchase_order_id=order_row.id
);

CREATE TABLE IF NOT EXISTS purchase_bill_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','extracting','review','confirmed','cancelled','extraction_failed')),
  source_file_name TEXT NOT NULL CHECK (BTRIM(source_file_name) <> ''),
  source_content_type TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (LENGTH(source_sha256) = 64),
  source_size_bytes BIGINT NOT NULL CHECK (source_size_bytes > 0 AND source_size_bytes <= 10485760),
  source_bytes BYTEA NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  purchase_receipt_id TEXT REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_gstin TEXT NOT NULL DEFAULT '',
  bill_number TEXT NOT NULL DEFAULT '',
  bill_date DATE,
  subtotal_paise BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
  discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  cgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise BIGINT NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_paise BIGINT NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  confidence_bps INTEGER NOT NULL DEFAULT 0 CHECK (confidence_bps BETWEEN 0 AND 10000),
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  field_evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  cancelled_by TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, source_sha256)
);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_drafts_scope
  ON purchase_bill_drafts (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_bill_draft_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  draft_id TEXT NOT NULL REFERENCES purchase_bill_drafts(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  raw_name TEXT NOT NULL DEFAULT '',
  supplier_sku TEXT NOT NULL DEFAULT '',
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE RESTRICT,
  hsn_sac TEXT NOT NULL DEFAULT '',
  purchase_quantity INTEGER NOT NULL DEFAULT 0 CHECK (purchase_quantity >= 0),
  pack_size INTEGER NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  conversion_factor INTEGER NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0),
  discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
  discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  gst_percent INTEGER NOT NULL DEFAULT 0 CHECK (gst_percent BETWEEN 0 AND 100),
  taxable_paise BIGINT NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  cgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise BIGINT NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_paise BIGINT NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  batch_number TEXT NOT NULL DEFAULT '',
  expiry_date DATE,
  confidence_bps INTEGER NOT NULL DEFAULT 0 CHECK (confidence_bps BETWEEN 0 AND 10000),
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  field_evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (draft_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_draft_lines_scope
  ON purchase_bill_draft_lines (tenant_id, branch_id, draft_id, line_number);

CREATE TABLE IF NOT EXISTS purchase_bill_extractions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  draft_id TEXT NOT NULL REFERENCES purchase_bill_drafts(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'local',
  model_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
  raw_response JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_extractions_scope
  ON purchase_bill_extractions (tenant_id, branch_id, draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_bill_matches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  draft_id TEXT NOT NULL REFERENCES purchase_bill_drafts(id) ON DELETE RESTRICT,
  draft_line_id TEXT REFERENCES purchase_bill_draft_lines(id) ON DELETE RESTRICT,
  match_type TEXT NOT NULL CHECK (match_type IN ('supplier','inventory_item','purchase_order','two_way','three_way','duplicate')),
  matched_entity_id TEXT NOT NULL,
  score_bps INTEGER NOT NULL DEFAULT 0 CHECK (score_bps BETWEEN 0 AND 10000),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','accepted','rejected','confirmed')),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_matches_scope
  ON purchase_bill_matches (tenant_id, branch_id, draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_bill_draft_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  draft_id TEXT NOT NULL REFERENCES purchase_bill_drafts(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (BTRIM(event_type) <> ''),
  actor_user_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_draft_events_scope
  ON purchase_bill_draft_events (tenant_id, branch_id, draft_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_purchase_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'purchase workflow events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_order_events_immutable ON purchase_order_events;
CREATE TRIGGER trg_purchase_order_events_immutable
BEFORE UPDATE OR DELETE ON purchase_order_events
FOR EACH ROW EXECUTE FUNCTION prevent_purchase_event_mutation();

DROP TRIGGER IF EXISTS trg_purchase_bill_draft_events_immutable ON purchase_bill_draft_events;
CREATE TRIGGER trg_purchase_bill_draft_events_immutable
BEFORE UPDATE OR DELETE ON purchase_bill_draft_events
FOR EACH ROW EXECUTE FUNCTION prevent_purchase_event_mutation();
