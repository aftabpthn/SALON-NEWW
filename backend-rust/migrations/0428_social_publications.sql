CREATE TABLE IF NOT EXISTS social_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  caption TEXT NOT NULL,
  media_url TEXT NOT NULL DEFAULT '',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  request_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider_container_id TEXT NOT NULL DEFAULT '',
  provider_post_id TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 30,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, idempotency_key),
  CONSTRAINT social_publication_provider CHECK (provider IN ('facebook','instagram')),
  CONSTRAINT social_publication_status CHECK (status IN ('queued','processing','retry','published','failed','uncertain','cancelled')),
  CONSTRAINT social_publication_attempts CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_social_publications_due
  ON social_publications(next_attempt_at, scheduled_at)
  WHERE status IN ('queued','retry');

CREATE INDEX IF NOT EXISTS idx_social_publications_scope
  ON social_publications(tenant_id, branch_id, created_at DESC);
