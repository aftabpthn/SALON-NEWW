CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_tenant_code
  ON branches(tenant_id, LOWER(code))
  WHERE code IS NOT NULL AND BTRIM(code) <> '';
