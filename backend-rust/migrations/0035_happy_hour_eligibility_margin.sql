ALTER TABLE pos_happy_hour_rules
  ADD COLUMN IF NOT EXISTS eligible_line_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS eligible_item_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS eligible_client_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_margin_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS block_on_unknown_cost BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE pos_happy_hour_rules
  ADD CONSTRAINT pos_happy_hour_rules_margin_range
  CHECK (min_margin_bps BETWEEN 0 AND 10000) NOT VALID;
