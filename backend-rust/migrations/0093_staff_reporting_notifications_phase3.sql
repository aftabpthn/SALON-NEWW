CREATE TABLE IF NOT EXISTS staff_notification_preferences (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  allow_payroll_amounts BOOLEAN NOT NULL DEFAULT FALSE,
  language_code TEXT NOT NULL DEFAULT 'en-IN',
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, staff_id)
);

CREATE TABLE IF NOT EXISTS staff_notification_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  language_code TEXT NOT NULL DEFAULT 'en-IN',
  title TEXT NOT NULL,
  body_template TEXT NOT NULL,
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, notification_type, language_code)
);

CREATE TABLE IF NOT EXISTS staff_notification_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  template_id TEXT REFERENCES staff_notification_templates(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','in_app')),
  notification_type TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  message_body TEXT NOT NULL,
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('approval_required','queued','approved','sent','failed','cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  provider TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_notification_queue_scope
  ON staff_notification_queue(tenant_id, branch_id, status, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS staff_notification_delivery_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  queue_id TEXT NOT NULL REFERENCES staff_notification_queue(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_message_id TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('sent','failed')),
  error_message TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_notification_logs_scope
  ON staff_notification_delivery_logs(tenant_id, branch_id, queue_id, created_at DESC);
