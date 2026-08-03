ALTER TABLE staff_payroll_runs
  DROP CONSTRAINT IF EXISTS staff_payroll_runs_cycle_check;

ALTER TABLE staff_payroll_runs
  ADD CONSTRAINT staff_payroll_runs_cycle_check
  CHECK (cycle IN ('monthly','off_cycle','final_settlement'));

ALTER TABLE staff_payroll_runs
  ADD COLUMN IF NOT EXISTS subject_staff_id TEXT NOT NULL DEFAULT '';

ALTER TABLE staff_payroll_runs
  DROP CONSTRAINT IF EXISTS staff_payroll_runs_tenant_id_branch_id_cycle_period_start_p_key;

ALTER TABLE staff_payroll_runs
  ADD CONSTRAINT staff_payroll_runs_scope_cycle_period_subject_key
  UNIQUE (tenant_id,branch_id,cycle,period_start,period_end,subject_staff_id);

ALTER TABLE staff_payroll_runs
  ADD CONSTRAINT staff_payroll_runs_subject_scope_check
  CHECK ((cycle='monthly' AND subject_staff_id='') OR (cycle<>'monthly' AND subject_staff_id<>''));

CREATE OR REPLACE FUNCTION prevent_staff_ai_scribe_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'staff AI Scribe events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_ai_scribe_events_immutable ON staff_ai_scribe_events;
CREATE TRIGGER trg_staff_ai_scribe_events_immutable
BEFORE UPDATE OR DELETE ON staff_ai_scribe_events
FOR EACH ROW EXECUTE FUNCTION prevent_staff_ai_scribe_event_mutation();

COMMENT ON CONSTRAINT staff_payroll_runs_cycle_check ON staff_payroll_runs IS
  'Monthly payroll plus single-employee off-cycle and final-settlement runs.';
