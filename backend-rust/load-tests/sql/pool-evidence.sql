-- Read-only PostgreSQL evidence to capture during a capacity run.
-- Run with a monitoring account against the same staging RDS instance.

SELECT
  NOW() AS captured_at,
  current_database() AS database_name,
  current_setting('max_connections')::integer AS max_connections,
  COUNT(*) FILTER (WHERE backend_type = 'client backend') AS client_connections,
  COUNT(*) FILTER (WHERE backend_type = 'client backend' AND state = 'active') AS active_connections,
  COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL) AS waiting_connections
FROM pg_stat_activity;

SELECT
  application_name,
  state,
  wait_event_type,
  wait_event,
  COUNT(*) AS connections,
  MAX(EXTRACT(EPOCH FROM (NOW() - query_start))) FILTER (WHERE state = 'active') AS longest_active_seconds
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY application_name, state, wait_event_type, wait_event
ORDER BY connections DESC, application_name;

SELECT
  datname,
  xact_commit,
  xact_rollback,
  deadlocks,
  temp_files,
  temp_bytes,
  CASE
    WHEN blks_hit + blks_read = 0 THEN 100.0
    ELSE ROUND(100.0 * blks_hit / (blks_hit + blks_read), 2)
  END AS postgres_buffer_hit_percent
FROM pg_stat_database
WHERE datname = current_database();

SELECT
  relname,
  seq_scan,
  idx_scan,
  n_live_tup,
  n_dead_tup,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY seq_scan DESC, n_live_tup DESC
LIMIT 25;

