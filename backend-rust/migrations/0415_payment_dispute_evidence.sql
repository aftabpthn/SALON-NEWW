-- Dispute evidence preparation.
--
-- payment_disputes has recorded chargebacks since 0153 and the webhook path
-- keeps it current, but nothing helped anyone answer one. A dispute arrives
-- with an evidence_due_at and a clock, and the facts that answer it — what was
-- bought, whether the guest actually attended, what they signed, how long they
-- have been a customer — are spread across half the schema.
--
-- The pack itself is assembled from live records rather than duplicated here.
-- What is stored is the snapshot that was actually submitted: once a response
-- goes to the provider, "what did we send them" has to survive later edits to
-- the underlying appointment or invoice.

ALTER TABLE payment_disputes
  ADD COLUMN IF NOT EXISTS evidence_pack_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS evidence_prepared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_prepared_by TEXT NOT NULL DEFAULT '',
  -- How defensible the case looked when it was prepared, with the factors that
  -- produced it. Stored alongside the pack so a later review can see whether a
  -- loss was predictable or surprising.
  ADD COLUMN IF NOT EXISTS strength_score INTEGER NOT NULL DEFAULT 0
    CHECK (strength_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS strength_factors_json JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE payment_disputes
  ADD CONSTRAINT payment_disputes_evidence_pack_object
    CHECK (JSONB_TYPEOF(evidence_pack_json) = 'object') NOT VALID;

ALTER TABLE payment_disputes
  ADD CONSTRAINT payment_disputes_strength_factors_array
    CHECK (JSONB_TYPEOF(strength_factors_json) = 'array') NOT VALID;

-- The work queue orders by deadline: an unanswered dispute with a deadline this
-- week outranks a larger one with a month left.
CREATE INDEX IF NOT EXISTS idx_payment_disputes_evidence_due
  ON payment_disputes (tenant_id, branch_id, evidence_due_at)
  WHERE status IN ('open', 'under_review');
