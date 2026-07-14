CREATE TABLE IF NOT EXISTS staff_mobile_devices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_uid TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios','web','windows')),
  sync_token_hash TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, device_uid)
);

CREATE INDEX IF NOT EXISTS idx_staff_mobile_devices_scope
  ON staff_mobile_devices(tenant_id, branch_id, staff_id, active);

CREATE TABLE IF NOT EXISTS staff_mobile_sync_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES staff_mobile_devices(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','processed','conflict')),
  result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, device_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_mobile_sync_requests_scope
  ON staff_mobile_sync_requests(tenant_id, branch_id, staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_mobile_conflicts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES staff_mobile_devices(id) ON DELETE CASCADE,
  sync_request_id TEXT NOT NULL REFERENCES staff_mobile_sync_requests(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL,
  local_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  reason_code TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'server_wins' CHECK (resolution IN ('server_wins','client_wins','manual')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, sync_request_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_mobile_conflicts_scope
  ON staff_mobile_conflicts(tenant_id, branch_id, status, created_at DESC);
