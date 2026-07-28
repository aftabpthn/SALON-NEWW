ALTER TABLE purchase_receipt_lines
    ADD COLUMN rejected_quantity INTEGER NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
    ADD COLUMN landed_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (landed_cost_paise >= 0),
    ADD COLUMN landed_unit_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (landed_unit_cost_paise >= 0);

UPDATE purchase_receipt_lines
SET landed_unit_cost_paise = unit_cost_paise;

ALTER TABLE purchase_receipt_lines DROP CONSTRAINT IF EXISTS purchase_receipt_lines_delivery_check;
ALTER TABLE purchase_receipt_lines
    ADD CONSTRAINT purchase_receipt_lines_delivery_check
    CHECK (quantity + damaged_quantity + rejected_quantity = delivered_quantity);

CREATE TABLE inventory_receiving_quarantine (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    purchase_receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
    purchase_receipt_line_id TEXT NOT NULL REFERENCES purchase_receipt_lines(id) ON DELETE RESTRICT,
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL DEFAULT 'quarantined'
        CHECK (status IN ('quarantined', 'released', 'returned', 'discarded')),
    reason TEXT NOT NULL,
    batch_number TEXT NOT NULL DEFAULT '',
    batch_barcode TEXT NOT NULL DEFAULT '',
    expiry_date DATE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    UNIQUE (tenant_id, branch_id, purchase_receipt_line_id)
);

CREATE INDEX inventory_receiving_quarantine_open_idx
    ON inventory_receiving_quarantine (tenant_id, branch_id, status, created_at DESC);
