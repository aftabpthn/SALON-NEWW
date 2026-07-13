CREATE TABLE IF NOT EXISTS pos_payment_method_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  settlement_type TEXT NOT NULL,
  shortcut TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  show_on_invoice BOOLEAN NOT NULL DEFAULT TRUE,
  reference_required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_method_settings_code
  ON pos_payment_method_settings (tenant_id, branch_id, LOWER(code));

CREATE INDEX IF NOT EXISTS idx_pos_payment_method_settings_active
  ON pos_payment_method_settings (tenant_id, branch_id, active, sort_order);

INSERT INTO pos_payment_method_settings (
  tenant_id, branch_id, code, name, settlement_type, shortcut, sort_order
)
SELECT branches.tenant_id, branches.id, defaults.code, defaults.name, defaults.settlement_type, defaults.shortcut, defaults.sort_order
FROM branches
CROSS JOIN (
  VALUES
    ('cash', 'Cash', 'cash', 'C', 10),
    ('upi', 'UPI', 'upi', 'U', 20),
    ('card', 'Card', 'card', 'D', 30),
    ('wallet', 'Wallet', 'wallet', 'W', 40),
    ('bank_transfer', 'Online / Bank Transfer', 'bank_transfer', 'B', 50),
    ('gift_card', 'Gift Card', 'gift_card', 'G', 60),
    ('store_credit', 'Store Credit', 'store_credit', 'S', 70)
) AS defaults(code, name, settlement_type, shortcut, sort_order)
ON CONFLICT DO NOTHING;
