ALTER TABLE staff_salary_advances
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE staff_salary_advances
  ADD CONSTRAINT staff_salary_advances_terminal_balance_check
  CHECK (status NOT IN ('closed','waived') OR outstanding_paise = 0);

ALTER TABLE staff_advance_recoveries
  ADD CONSTRAINT staff_advance_recoveries_amount_check
  CHECK (
    recovered_paise <= scheduled_paise
    AND carried_forward_paise = scheduled_paise - recovered_paise
  );
