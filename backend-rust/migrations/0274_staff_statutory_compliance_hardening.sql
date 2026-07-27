ALTER TABLE staff_statutory_profiles
  ADD COLUMN uan_ciphertext TEXT NOT NULL DEFAULT '',
  ADD COLUMN uan_last_four TEXT NOT NULL DEFAULT '',
  ADD COLUMN esic_number_ciphertext TEXT NOT NULL DEFAULT '',
  ADD COLUMN esic_number_last_four TEXT NOT NULL DEFAULT '',
  ADD COLUMN pan_number_ciphertext TEXT NOT NULL DEFAULT '',
  ADD COLUMN pan_number_last_four TEXT NOT NULL DEFAULT '';

ALTER TABLE staff_statutory_profiles
  ADD CONSTRAINT staff_statutory_profiles_plaintext_empty
    CHECK (uan = '' AND esic_number = '' AND pan_number = '') NOT VALID;

ALTER TABLE staff_payroll_statutory_rules
  ADD COLUMN jurisdiction_code TEXT NOT NULL DEFAULT 'IN',
  ADD COLUMN rounding_method TEXT NOT NULL DEFAULT 'floor_paisa',
  ADD COLUMN official_reference TEXT NOT NULL DEFAULT 'legacy-unverified',
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN approved_by TEXT,
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN review_note TEXT NOT NULL DEFAULT '';

UPDATE staff_payroll_statutory_rules
SET jurisdiction_code = CASE
      WHEN BTRIM(state_code) = '' THEN 'IN'
      ELSE 'IN-' || UPPER(BTRIM(state_code))
    END,
    approved_by = created_by,
    approved_at = created_at
WHERE approved_by IS NULL;

ALTER TABLE staff_payroll_statutory_rules
  ADD CONSTRAINT staff_statutory_rules_rounding_method
    CHECK (rounding_method IN ('floor_paisa','nearest_paisa','ceil_paisa','nearest_rupee')),
  ADD CONSTRAINT staff_statutory_rules_approval_status
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD CONSTRAINT staff_statutory_rules_jurisdiction_required
    CHECK (BTRIM(jurisdiction_code) <> ''),
  ADD CONSTRAINT staff_statutory_rules_reference_required
    CHECK (BTRIM(official_reference) <> '');

CREATE INDEX idx_staff_statutory_rules_governance
  ON staff_payroll_statutory_rules(tenant_id, branch_id, approval_status, active, effective_from DESC);
