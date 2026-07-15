CREATE SEQUENCE IF NOT EXISTS auth_audit_chain_sequence AS BIGINT;

ALTER TABLE auth_audit_logs
  ADD COLUMN IF NOT EXISTS chain_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT;

CREATE TABLE IF NOT EXISTS auth_audit_chain_heads (
  tenant_id TEXT PRIMARY KEY,
  head_hash TEXT NOT NULL DEFAULT '',
  event_count BIGINT NOT NULL DEFAULT 0,
  last_event_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth_audit_entry_hash(
  p_chain_sequence BIGINT,
  p_id TEXT,
  p_tenant_id TEXT,
  p_user_id TEXT,
  p_session_id TEXT,
  p_branch_id TEXT,
  p_identity TEXT,
  p_event_type TEXT,
  p_outcome TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_details_json JSONB,
  p_created_at TIMESTAMPTZ,
  p_previous_hash TEXT
) RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_object(
          'sequence', p_chain_sequence,
          'id', p_id,
          'tenantId', p_tenant_id,
          'userId', p_user_id,
          'sessionId', p_session_id,
          'branchId', p_branch_id,
          'identity', p_identity,
          'eventType', p_event_type,
          'outcome', p_outcome,
          'ipAddress', p_ip_address,
          'userAgent', p_user_agent,
          'details', COALESCE(p_details_json, '{}'::JSONB),
          'createdAt', to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'previousHash', COALESCE(p_previous_hash, '')
        )::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

DROP TRIGGER IF EXISTS auth_audit_logs_append_only ON auth_audit_logs;
DROP TRIGGER IF EXISTS auth_audit_logs_chain_insert ON auth_audit_logs;
TRUNCATE auth_audit_chain_heads;
SELECT setval('auth_audit_chain_sequence', 1, FALSE);

DO $$
DECLARE
  tenant_row RECORD;
  audit_row RECORD;
  previous_value TEXT;
  hash_value TEXT;
  sequence_value BIGINT;
  tenant_events BIGINT;
BEGIN
  FOR tenant_row IN
    SELECT DISTINCT tenant_id FROM auth_audit_logs ORDER BY tenant_id
  LOOP
    previous_value := '';
    tenant_events := 0;
    FOR audit_row IN
      SELECT * FROM auth_audit_logs
      WHERE tenant_id = tenant_row.tenant_id
      ORDER BY created_at, id
    LOOP
      sequence_value := nextval('auth_audit_chain_sequence');
      hash_value := auth_audit_entry_hash(
        sequence_value,
        audit_row.id,
        audit_row.tenant_id,
        audit_row.user_id,
        audit_row.session_id,
        audit_row.branch_id,
        audit_row.identity,
        audit_row.event_type,
        audit_row.outcome,
        audit_row.ip_address,
        audit_row.user_agent,
        audit_row.details_json,
        audit_row.created_at,
        previous_value
      );
      UPDATE auth_audit_logs
      SET chain_sequence = sequence_value,
          previous_hash = previous_value,
          entry_hash = hash_value
      WHERE id = audit_row.id;
      previous_value := hash_value;
      tenant_events := tenant_events + 1;
    END LOOP;

    INSERT INTO auth_audit_chain_heads
      (tenant_id, head_hash, event_count, last_event_id)
    SELECT tenant_row.tenant_id, previous_value, tenant_events, id
    FROM auth_audit_logs
    WHERE tenant_id = tenant_row.tenant_id
    ORDER BY chain_sequence DESC
    LIMIT 1;
  END LOOP;
END $$;

ALTER TABLE auth_audit_logs
  ALTER COLUMN chain_sequence SET NOT NULL,
  ALTER COLUMN previous_hash SET NOT NULL,
  ALTER COLUMN previous_hash SET DEFAULT '',
  ALTER COLUMN entry_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_audit_logs_chain_sequence
  ON auth_audit_logs(chain_sequence);

CREATE OR REPLACE FUNCTION seal_auth_audit_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  previous_value TEXT;
BEGIN
  INSERT INTO auth_audit_chain_heads(tenant_id)
  VALUES (NEW.tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT head_hash INTO previous_value
  FROM auth_audit_chain_heads
  WHERE tenant_id = NEW.tenant_id
  FOR UPDATE;

  NEW.chain_sequence := nextval('auth_audit_chain_sequence');
  NEW.previous_hash := COALESCE(previous_value, '');
  NEW.entry_hash := auth_audit_entry_hash(
    NEW.chain_sequence,
    NEW.id,
    NEW.tenant_id,
    NEW.user_id,
    NEW.session_id,
    NEW.branch_id,
    NEW.identity,
    NEW.event_type,
    NEW.outcome,
    NEW.ip_address,
    NEW.user_agent,
    NEW.details_json,
    NEW.created_at,
    NEW.previous_hash
  );

  UPDATE auth_audit_chain_heads
  SET head_hash = NEW.entry_hash,
      event_count = event_count + 1,
      last_event_id = NEW.id,
      updated_at = NOW()
  WHERE tenant_id = NEW.tenant_id;
  RETURN NEW;
END $$;

CREATE TRIGGER auth_audit_logs_chain_insert
BEFORE INSERT ON auth_audit_logs
FOR EACH ROW EXECUTE FUNCTION seal_auth_audit_insert();

CREATE OR REPLACE FUNCTION prevent_auth_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'auth audit records are append-only';
END $$;

CREATE TRIGGER auth_audit_logs_append_only
BEFORE UPDATE OR DELETE ON auth_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_auth_audit_mutation();

DO $$
BEGIN
  IF EXISTS (
    WITH ordered AS (
      SELECT
        audit.*,
        COALESCE(
          LAG(entry_hash) OVER (PARTITION BY tenant_id ORDER BY chain_sequence),
          ''
        ) AS expected_previous
      FROM auth_audit_logs audit
    )
    SELECT 1
    FROM ordered
    WHERE previous_hash <> expected_previous
       OR entry_hash <> auth_audit_entry_hash(
         chain_sequence, id, tenant_id, user_id, session_id, branch_id,
         identity, event_type, outcome, ip_address, user_agent, details_json,
         created_at, previous_hash
       )
  ) THEN
    RAISE EXCEPTION 'auth audit chain backfill verification failed';
  END IF;
END $$;
