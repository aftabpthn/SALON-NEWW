-- Governance for client-data exports.
--
-- /clients/bulk/export required only `clients.read` — the permission every
-- receptionist has — and returned up to 5000 client records with phone and email per
-- request, paging freely through the whole book. Nothing rate limited it,
-- nothing capped a day's total, and nothing recorded that it happened. The
-- master audit tracks changes to client records; reading them in bulk left no
-- trace at all.
--
-- For a salon that is the largest insider risk there is: the client list is the
-- business, and it walked out of the door invisibly.
--
-- This records every export and gives the day a ceiling. It does not try to
-- stop exports — they are a legitimate thing to need — it makes them visible,
-- bounded, and attributable.

CREATE TABLE IF NOT EXISTS client_export_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_name TEXT NOT NULL DEFAULT '',
  export_kind TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  -- The search and paging that produced this set, so a reviewer can tell a
  -- targeted lookup from a sweep of the whole book.
  filters_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  source_ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  -- Returned to the caller on the response. A file that leaks carries the
  -- marker of the export it came from, which turns "someone took the list" into
  -- a specific person, time and filter.
  watermark TEXT NOT NULL,
  -- Set when the export exceeded the day's budget and a temporary elevation
  -- allowed it through anyway.
  elevated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (JSONB_TYPEOF(filters_json) = 'object')
);

-- The budget check sums a single user's rows for the current day, and the
-- review screen reads a branch's recent history.
CREATE INDEX IF NOT EXISTS idx_client_export_events_user_day
  ON client_export_events (tenant_id, branch_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_export_events_recent
  ON client_export_events (tenant_id, branch_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_export_events_watermark
  ON client_export_events (watermark);
