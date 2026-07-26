ALTER TABLE staff_payroll_adjustment_rules
  DROP CONSTRAINT IF EXISTS staff_payroll_adjustment_rules_trigger_type_check;

ALTER TABLE staff_payroll_adjustment_rules
  ADD CONSTRAINT staff_payroll_adjustment_rules_trigger_type_check
  CHECK (trigger_type IN (
    'manual','late_count','absent_day','half_day','short_hours','no_clock_out',
    'weekend_penalty','sandwich_penalty','unpaid_week_off','fixed','weekly_off_worked'
  ));
