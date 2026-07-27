-- Statutory rule governance: no rate lives in source code, and every
-- configured rule carries its legal provenance — official reference,
-- approver, rounding method, and structured applicability conditions.
ALTER TABLE staff_payroll_statutory_rules
  ADD COLUMN IF NOT EXISTS rounding_method TEXT NOT NULL DEFAULT 'floor'
    CHECK (rounding_method IN ('floor','nearest_paisa','ceiling_paisa','floor_rupee','nearest_rupee','ceiling_rupee')),
  ADD COLUMN IF NOT EXISTS official_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applicability_json JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(applicability_json) = 'object');
