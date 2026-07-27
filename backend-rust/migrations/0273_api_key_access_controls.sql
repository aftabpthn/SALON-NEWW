ALTER TABLE integration_api_keys
  ADD COLUMN ip_allowlist_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN rate_limit_per_minute INTEGER NOT NULL DEFAULT 60;

ALTER TABLE integration_api_keys
  ADD CONSTRAINT integration_api_keys_ip_allowlist_array
    CHECK (jsonb_typeof(ip_allowlist_json) = 'array'),
  ADD CONSTRAINT integration_api_keys_rate_limit_range
    CHECK (rate_limit_per_minute BETWEEN 1 AND 10000);
