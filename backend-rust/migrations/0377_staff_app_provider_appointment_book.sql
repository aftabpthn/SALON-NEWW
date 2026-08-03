ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS last_mutation_key TEXT NOT NULL DEFAULT '';

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_last_mutation_key_length;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_last_mutation_key_length
  CHECK (last_mutation_key = '' OR CHAR_LENGTH(last_mutation_key) BETWEEN 8 AND 160);

CREATE INDEX IF NOT EXISTS idx_appointments_staff_app_mutation
  ON appointments(tenant_id, branch_id, last_mutation_key)
  WHERE last_mutation_key <> '';
