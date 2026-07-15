CREATE TABLE IF NOT EXISTS birthday_anniversary_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  workflow_mode TEXT NOT NULL DEFAULT 'legacy_auto'
    CHECK (workflow_mode IN ('legacy_auto', 'managed')),
  popup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  auto_send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_send_time TIME NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata' CHECK (BTRIM(timezone) <> ''),
  days_ahead SMALLINT NOT NULL DEFAULT 30 CHECK (days_ahead BETWEEN 1 AND 366),
  channels TEXT[] NOT NULL DEFAULT ARRAY['whatsapp']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, branch_id),
  CONSTRAINT birthday_anniversary_settings_channels_check CHECK (
    CARDINALITY(channels) BETWEEN 1 AND 3
    AND channels <@ ARRAY['whatsapp', 'sms', 'email']::TEXT[]
  )
);

CREATE TABLE IF NOT EXISTS birthday_anniversary_reminders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('birthday', 'anniversary')),
  event_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'queued', 'sent', 'failed', 'blocked', 'cancelled')),
  channels TEXT[] NOT NULL DEFAULT ARRAY['whatsapp']::TEXT[],
  message_options_json JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (JSONB_TYPEOF(message_options_json) = 'array'),
  selected_message TEXT NOT NULL DEFAULT '',
  coupon_id TEXT REFERENCES pos_coupons(id) ON DELETE SET NULL,
  scheduled_send_at TIMESTAMPTZ,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failure_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT birthday_anniversary_reminders_channels_check CHECK (
    CARDINALITY(channels) BETWEEN 1 AND 3
    AND channels <@ ARRAY['whatsapp', 'sms', 'email']::TEXT[]
  ),
  CONSTRAINT birthday_anniversary_reminders_approval_check CHECK (
    status <> 'approved'
    OR (approved_at IS NOT NULL AND BTRIM(approved_by) <> '')
  ),
  CONSTRAINT birthday_anniversary_reminders_message_check CHECK (
    status NOT IN ('approved', 'queued', 'sent') OR BTRIM(selected_message) <> ''
  ),
  CONSTRAINT birthday_anniversary_reminders_queued_check CHECK (
    status <> 'queued' OR queued_at IS NOT NULL
  ),
  CONSTRAINT birthday_anniversary_reminders_sent_check CHECK (
    status <> 'sent' OR sent_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_birthday_anniversary_reminders_event_cycle
  ON birthday_anniversary_reminders (
    tenant_id,
    branch_id,
    client_id,
    event_type,
    (EXTRACT(YEAR FROM event_date))
  );

CREATE INDEX IF NOT EXISTS idx_birthday_anniversary_reminders_event_window
  ON birthday_anniversary_reminders (tenant_id, branch_id, event_date, event_type);

CREATE INDEX IF NOT EXISTS idx_birthday_anniversary_reminders_queue
  ON birthday_anniversary_reminders (
    tenant_id,
    branch_id,
    status,
    scheduled_send_at,
    event_date
  )
  WHERE status IN ('draft', 'approved', 'queued', 'failed', 'blocked');

CREATE INDEX IF NOT EXISTS idx_birthday_anniversary_reminders_client
  ON birthday_anniversary_reminders (tenant_id, branch_id, client_id, event_date DESC);

CREATE TABLE IF NOT EXISTS birthday_anniversary_vouchers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL REFERENCES birthday_anniversary_reminders(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coupon_id TEXT NOT NULL REFERENCES pos_coupons(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'sent', 'redeemed', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  redeemed_sale_id TEXT REFERENCES pos_sales(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT birthday_anniversary_vouchers_sent_check CHECK (
    status <> 'sent' OR sent_at IS NOT NULL
  ),
  CONSTRAINT birthday_anniversary_vouchers_redeemed_check CHECK (
    status <> 'redeemed' OR redeemed_at IS NOT NULL
  ),
  UNIQUE (tenant_id, branch_id, reminder_id)
);

CREATE INDEX IF NOT EXISTS idx_birthday_anniversary_vouchers_client
  ON birthday_anniversary_vouchers (tenant_id, branch_id, client_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_birthday_anniversary_vouchers_open
  ON birthday_anniversary_vouchers (tenant_id, branch_id, status, expires_at)
  WHERE status IN ('created', 'sent');

CREATE TABLE IF NOT EXISTS birthday_anniversary_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  reminder_id TEXT REFERENCES birthday_anniversary_reminders(id) ON DELETE SET NULL,
  voucher_id TEXT REFERENCES birthday_anniversary_vouchers(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (BTRIM(action) <> ''),
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(details_json) = 'object'),
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_birthday_anniversary_audit_scope
  ON birthday_anniversary_audit_events (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_birthday_anniversary_audit_reminder
  ON birthday_anniversary_audit_events (
    tenant_id,
    branch_id,
    reminder_id,
    created_at DESC
  )
  WHERE reminder_id IS NOT NULL;
