CREATE TABLE IF NOT EXISTS inventory_exception_reviews (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  recommendation_key TEXT NOT NULL CHECK (BTRIM(recommendation_key) <> ''),
  category TEXT NOT NULL CHECK (BTRIM(category) <> ''),
  evidence_hash TEXT NOT NULL CHECK (LENGTH(evidence_hash) = 64),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL CHECK (BTRIM(reviewed_by) <> ''),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_exception_reviews_latest
  ON inventory_exception_reviews (
    tenant_id, branch_id, recommendation_key, evidence_hash, reviewed_at DESC, id DESC
  );
