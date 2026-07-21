CREATE TABLE IF NOT EXISTS public_booking_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'portal',
  device_type TEXT NOT NULL DEFAULT '',
  contact_value TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  appointment_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','abandoned','recovery_queued','recovered')),
  last_event TEXT NOT NULL DEFAULT 'session_started',
  last_step INTEGER NOT NULL DEFAULT 0,
  event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  converted_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  recovered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_public_booking_sessions_funnel
  ON public_booking_sessions (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_booking_sessions_abandonment
  ON public_booking_sessions (status, last_event_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public_booking_session_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES public_booking_sessions(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_booking_session_events_funnel
  ON public_booking_session_events (tenant_id, branch_id, event_name, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_recovery_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES public_booking_sessions(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','whatsapp','email')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  requested_by TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (session_id, channel)
);
