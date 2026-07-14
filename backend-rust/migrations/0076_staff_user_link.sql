ALTER TABLE staff ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_user_id
  ON users(tenant_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'staff'::regclass
      AND conname = 'fk_staff_tenant_user'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT fk_staff_tenant_user
      FOREIGN KEY (tenant_id, user_id)
      REFERENCES users(tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

WITH candidates AS (
  SELECT
    s.id AS staff_id,
    s.tenant_id,
    s.branch_id,
    u.id AS user_id,
    COUNT(*) OVER (PARTITION BY s.id) AS user_matches,
    COUNT(*) OVER (PARTITION BY s.tenant_id, s.branch_id, u.id) AS staff_matches
  FROM staff s
  JOIN users u
    ON u.tenant_id = s.tenant_id
   AND LOWER(u.email) = LOWER(s.email)
   AND u.active = TRUE
  JOIN user_branch_roles ubr
    ON ubr.tenant_id = s.tenant_id
   AND ubr.user_id = u.id
   AND ubr.branch_id = s.branch_id
   AND ubr.active = TRUE
  WHERE s.user_id IS NULL
    AND s.active = TRUE
    AND BTRIM(s.email) <> ''
)
UPDATE staff s
SET user_id = candidate.user_id, updated_at = NOW()
FROM candidates candidate
WHERE s.id = candidate.staff_id
  AND candidate.user_matches = 1
  AND candidate.staff_matches = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tenant_branch_user
  ON staff(tenant_id, branch_id, user_id)
  WHERE user_id IS NOT NULL;
