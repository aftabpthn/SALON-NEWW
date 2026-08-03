-- Leadership tenure for background workers.
--
-- A per-cycle advisory lock only prevents two replicas running a worker at the
-- same instant; because replicas tick out of phase they rarely collide, so all
-- of them still did the work. A lease gives one replica tenure for a window,
-- and everyone else skips outright.
--
-- Rows are bounded by the number of worker names in the binary, so this table
-- never grows with tenants or traffic and needs no retention policy.
CREATE TABLE IF NOT EXISTS worker_leases (
  worker_name TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Lets a takeover find expired leases without scanning, and makes "who owns
-- what right now" a cheap operational query during an incident.
CREATE INDEX IF NOT EXISTS idx_worker_leases_expires_at ON worker_leases(expires_at);
