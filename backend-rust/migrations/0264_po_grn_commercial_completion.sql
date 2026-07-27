ALTER TABLE purchase_orders
    ADD COLUMN shipping_paise BIGINT NOT NULL DEFAULT 0 CHECK (shipping_paise >= 0),
    ADD COLUMN handling_paise BIGINT NOT NULL DEFAULT 0 CHECK (handling_paise >= 0);

ALTER TABLE purchase_order_lines
    ADD COLUMN discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
    ADD COLUMN discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0);

ALTER TABLE purchase_receipts
    ADD COLUMN grr_number TEXT,
    ADD COLUMN supplier_invoice_date DATE,
    ADD COLUMN challan_number TEXT NOT NULL DEFAULT '',
    ADD COLUMN delivery_reference TEXT NOT NULL DEFAULT '',
    ADD COLUMN shipping_paise BIGINT NOT NULL DEFAULT 0 CHECK (shipping_paise >= 0),
    ADD COLUMN handling_paise BIGINT NOT NULL DEFAULT 0 CHECK (handling_paise >= 0);

UPDATE purchase_receipts
SET grr_number = 'GRR-' || TO_CHAR(created_at, 'YYYYMMDD') || '-' ||
    UPPER(SUBSTRING(REPLACE(id, '-', '') FROM 1 FOR 8)),
    supplier_invoice_date = received_date
WHERE grr_number IS NULL;

ALTER TABLE purchase_receipts
    ALTER COLUMN grr_number SET NOT NULL,
    ALTER COLUMN supplier_invoice_date SET NOT NULL;

CREATE UNIQUE INDEX purchase_receipts_branch_grr_uq
    ON purchase_receipts(tenant_id, branch_id, grr_number);

ALTER TABLE purchase_receipt_lines
    ADD COLUMN gross_unit_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (gross_unit_cost_paise >= 0),
    ADD COLUMN discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
    ADD COLUMN discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
    ADD COLUMN ordered_quantity INTEGER CHECK (ordered_quantity IS NULL OR ordered_quantity >= 0),
    ADD COLUMN delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
    ADD COLUMN short_quantity INTEGER NOT NULL DEFAULT 0 CHECK (short_quantity >= 0),
    ADD COLUMN excess_quantity INTEGER NOT NULL DEFAULT 0 CHECK (excess_quantity >= 0),
    ADD COLUMN damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
    ADD COLUMN variance_reason TEXT NOT NULL DEFAULT '';

UPDATE purchase_receipt_lines
SET gross_unit_cost_paise = unit_cost_paise,
    delivered_quantity = quantity;

ALTER TABLE purchase_receipt_lines DROP CONSTRAINT IF EXISTS purchase_receipt_lines_quantity_check;
ALTER TABLE purchase_receipt_lines
    ADD CONSTRAINT purchase_receipt_lines_quantity_check CHECK (quantity >= 0),
    ADD CONSTRAINT purchase_receipt_lines_delivery_check CHECK (quantity + damaged_quantity = delivered_quantity);
