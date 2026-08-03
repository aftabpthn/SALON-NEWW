ALTER TABLE staff_schedules
  ADD COLUMN IF NOT EXISTS room_id TEXT,
  ADD COLUMN IF NOT EXISTS role_id TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS leave_request_id TEXT REFERENCES staff_leave_requests(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS staff_schedule_blockouts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(reason) <= 500),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_staff_schedule_blockouts_scope
  ON staff_schedule_blockouts(tenant_id, branch_id, staff_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS staff_calendar_feed_tokens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, staff_id, token_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_calendar_feed_active
  ON staff_calendar_feed_tokens(tenant_id, staff_id) WHERE active;

CREATE TABLE IF NOT EXISTS staff_work_task_pay_rates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL CHECK (CHAR_LENGTH(task_name) BETWEEN 1 AND 120),
  pay_rate_paise BIGINT NOT NULL DEFAULT 0 CHECK (pay_rate_paise >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, staff_id, task_name)
);

CREATE TABLE IF NOT EXISTS staff_attendance_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  attendance_id TEXT NOT NULL REFERENCES staff_attendance_records(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  work_task_rate_id TEXT REFERENCES staff_work_task_pay_rates(id) ON DELETE SET NULL,
  work_task_name TEXT NOT NULL DEFAULT '',
  pay_rate_paise BIGINT NOT NULL DEFAULT 0 CHECK (pay_rate_paise >= 0),
  source TEXT NOT NULL DEFAULT 'manual',
  cash_tip_paise BIGINT NOT NULL DEFAULT 0 CHECK (cash_tip_paise >= 0),
  comments TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(comments) <= 500),
  superseded_at TIMESTAMPTZ,
  superseded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (clock_out_at IS NULL OR clock_out_at >= clock_in_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_attendance_open_session
  ON staff_attendance_sessions(tenant_id, branch_id, staff_id)
  WHERE clock_out_at IS NULL AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_attendance_sessions_day
  ON staff_attendance_sessions(tenant_id, branch_id, staff_id, business_date, clock_in_at);

INSERT INTO staff_attendance_sessions(
  tenant_id,branch_id,staff_id,attendance_id,business_date,clock_in_at,clock_out_at,source,comments,superseded_at,superseded_by
)
SELECT tenant_id,branch_id,staff_id,id,business_date,clock_in_at,clock_out_at,source,comments,
       CASE WHEN clock_out_at IS NULL AND open_rank>1 THEN NOW() END,
       CASE WHEN clock_out_at IS NULL AND open_rank>1 THEN 'migration:0376-open-session-reconciliation' END
FROM (
  SELECT record.*,
         CASE WHEN clock_out_at IS NULL THEN ROW_NUMBER() OVER (
           PARTITION BY tenant_id,branch_id,staff_id,(clock_out_at IS NULL)
           ORDER BY business_date DESC,clock_in_at DESC,id DESC
         ) ELSE 0 END open_rank
  FROM staff_attendance_records record
  WHERE clock_in_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM staff_attendance_sessions session WHERE session.attendance_id=record.id)
) ranked;

ALTER TABLE staff_attendance_records
  ADD COLUMN IF NOT EXISTS cash_tip_paise BIGINT NOT NULL DEFAULT 0 CHECK (cash_tip_paise >= 0),
  ADD COLUMN IF NOT EXISTS session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0);

UPDATE staff_attendance_records record SET
  cash_tip_paise=COALESCE(source.cash_tip_paise,0),
  session_count=COALESCE(source.session_count,0)
FROM (
  SELECT attendance_id,SUM(cash_tip_paise)::BIGINT cash_tip_paise,COUNT(*)::INTEGER session_count
  FROM staff_attendance_sessions GROUP BY attendance_id
) source
WHERE record.id=source.attendance_id;

CREATE TABLE IF NOT EXISTS staff_attendance_correction_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  requested_clock_in_at TIMESTAMPTZ,
  requested_clock_out_at TIMESTAMPTZ,
  requested_work_task_rate_id TEXT REFERENCES staff_work_task_pay_rates(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(reason) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','approved','rejected','cancelled')),
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(review_note) <= 500),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (requested_clock_out_at IS NULL OR requested_clock_in_at IS NOT NULL),
  CHECK (requested_clock_out_at IS NULL OR requested_clock_out_at >= requested_clock_in_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_attendance_pending_correction
  ON staff_attendance_correction_requests(tenant_id, branch_id, staff_id, business_date)
  WHERE status='pending';

ALTER TABLE staff_attendance_rules
  ADD COLUMN IF NOT EXISTS scheduled_clock_in_mode TEXT NOT NULL DEFAULT 'allow'
    CHECK (scheduled_clock_in_mode IN ('allow','warn','block')),
  ADD COLUMN IF NOT EXISTS unscheduled_clock_in_mode TEXT NOT NULL DEFAULT 'warn'
    CHECK (unscheduled_clock_in_mode IN ('allow','warn','block')),
  ADD COLUMN IF NOT EXISTS early_clock_in_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (early_clock_in_minutes BETWEEN 0 AND 720),
  ADD COLUMN IF NOT EXISTS mandatory_break_after_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (mandatory_break_after_minutes BETWEEN 0 AND 1440),
  ADD COLUMN IF NOT EXISTS mandatory_break_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (mandatory_break_minutes BETWEEN 0 AND 480),
  ADD COLUMN IF NOT EXISTS automatic_break_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS forgot_clock_out_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (forgot_clock_out_minutes BETWEEN 0 AND 2880);

ALTER TABLE staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_status_check;
ALTER TABLE staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_status_check
  CHECK (status IN ('pending','approved','rejected','withdrawn','cancelled'));
ALTER TABLE staff_leave_requests
  ADD COLUMN IF NOT EXISTS requested_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (requested_days >= 0),
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(cancellation_reason) <= 500);
UPDATE staff_leave_requests SET requested_days=days WHERE requested_days=0;

CREATE TABLE IF NOT EXISTS staff_leave_request_days (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES staff_leave_requests(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  leave_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  day_fraction NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (day_fraction > 0 AND day_fraction <= 1),
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK (start_time IS NULL OR end_time > start_time),
  UNIQUE (request_id, leave_date)
);

CREATE TABLE IF NOT EXISTS staff_leave_schedule_backups (
  request_id TEXT NOT NULL REFERENCES staff_leave_requests(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  schedule_date DATE NOT NULL,
  existed BOOLEAN NOT NULL,
  shift1_start TIME,
  shift1_end TIME,
  shift2_start TIME,
  shift2_end TIME,
  status TEXT,
  notes TEXT,
  room_id TEXT,
  role_id TEXT,
  job_title TEXT,
  PRIMARY KEY(request_id,schedule_date)
);

INSERT INTO staff_leave_request_days(tenant_id,branch_id,request_id,staff_id,leave_date,day_fraction)
SELECT request.tenant_id,request.branch_id,request.id,request.staff_id,day::DATE,1
FROM staff_leave_requests request
CROSS JOIN LATERAL GENERATE_SERIES(request.start_date,request.end_date,INTERVAL '1 day') day
ON CONFLICT (request_id,leave_date) DO NOTHING;

ALTER TABLE staff_leave_policies
  ADD COLUMN IF NOT EXISTS accrual_mode TEXT NOT NULL DEFAULT 'annual'
    CHECK (accrual_mode IN ('annual','monthly','none')),
  ADD COLUMN IF NOT EXISTS allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS negative_limit_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (negative_limit_days >= 0),
  ADD COLUMN IF NOT EXISTS balance_cap_days NUMERIC(6,2) CHECK (balance_cap_days IS NULL OR balance_cap_days >= 0),
  ADD COLUMN IF NOT EXISTS carry_forward_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (carry_forward_days >= 0);

CREATE TABLE IF NOT EXISTS staff_leave_accrual_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL,
  effective_date DATE NOT NULL,
  days NUMERIC(6,2) NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('policy_allocation','carry_forward','manual_adjustment','expiry')),
  source_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_leave_accrual_history
  ON staff_leave_accrual_events(tenant_id, staff_id, leave_type, effective_date, created_at);

CREATE OR REPLACE FUNCTION audit_staff_leave_policy_accrual() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.annual_days IS DISTINCT FROM OLD.annual_days OR NEW.carry_forward_days IS DISTINCT FROM OLD.carry_forward_days THEN
    INSERT INTO staff_leave_accrual_events(tenant_id,branch_id,staff_id,leave_type,effective_date,days,event_type,source_id,notes)
    VALUES(NEW.tenant_id,NEW.branch_id,NEW.staff_id,NEW.leave_type,(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE,NEW.annual_days+NEW.carry_forward_days,'policy_allocation',NEW.id,'Policy balance configured');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_staff_leave_policy_accrual ON staff_leave_policies;
CREATE TRIGGER trg_audit_staff_leave_policy_accrual
AFTER INSERT OR UPDATE ON staff_leave_policies
FOR EACH ROW EXECUTE FUNCTION audit_staff_leave_policy_accrual();

ALTER TABLE staff_biometric_consents
  ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 1 AND 3650),
  ADD COLUMN IF NOT EXISTS retained_until TIMESTAMPTZ;
UPDATE staff_biometric_consents
SET retained_until=COALESCE(retained_until,COALESCE(granted_at,created_at)+(retention_days || ' days')::INTERVAL);

CREATE TABLE IF NOT EXISTS staff_leave_request_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_leave_request_events
  ON staff_leave_request_events(tenant_id, branch_id, request_id, created_at, id);

CREATE OR REPLACE FUNCTION audit_staff_leave_request_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO staff_leave_request_events(tenant_id,branch_id,request_id,event_type,status,version,snapshot_json)
  VALUES(NEW.tenant_id,NEW.branch_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,NEW.status,NEW.version,to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_staff_leave_request_change ON staff_leave_requests;
CREATE TRIGGER trg_audit_staff_leave_request_change
AFTER INSERT OR UPDATE ON staff_leave_requests
FOR EACH ROW EXECUTE FUNCTION audit_staff_leave_request_change();
