ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS normalized_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preferred_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_communication_channel TEXT NOT NULL DEFAULT 'none'
    CHECK (preferred_communication_channel IN ('none','whatsapp','sms','email','phone')),
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN,
  ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN,
  ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN,
  ADD COLUMN IF NOT EXISTS merged_into_client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT;

WITH normalized AS (
  SELECT id, REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') AS digits
  FROM clients
)
UPDATE clients client
SET normalized_phone = CASE
  WHEN normalized.digits = '' THEN ''
  WHEN LEFT(normalized.digits, 2) = '00' THEN '+' || SUBSTRING(normalized.digits FROM 3)
  WHEN LENGTH(normalized.digits) = 10 THEN '+91' || normalized.digits
  WHEN LENGTH(normalized.digits) = 11 AND LEFT(normalized.digits, 1) = '0' THEN '+91' || SUBSTRING(normalized.digits FROM 2)
  ELSE '+' || normalized.digits
END
FROM normalized
WHERE normalized.id = client.id AND client.normalized_phone = '';

DROP INDEX IF EXISTS idx_clients_tenant_phone;
CREATE INDEX IF NOT EXISTS idx_clients_normalized_phone
  ON clients (tenant_id, branch_id, normalized_phone)
  WHERE normalized_phone <> '' AND merged_into_client_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_merged_into
  ON clients (tenant_id, branch_id, merged_into_client_id)
  WHERE merged_into_client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_consent_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  opted_in BOOLEAN NOT NULL,
  source TEXT NOT NULL DEFAULT 'staff',
  reason TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_consent_events_client
  ON client_consent_events (tenant_id, branch_id, client_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS client_merge_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  target_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  source_snapshot JSONB NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_client_id <> target_client_id),
  UNIQUE (tenant_id, branch_id, source_client_id)
);
CREATE INDEX IF NOT EXISTS idx_client_merge_history_target
  ON client_merge_history (tenant_id, branch_id, target_client_id, merged_at DESC);

CREATE TABLE IF NOT EXISTS client_review_links (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('google','facebook','instagram','internal','other')),
  external_review_id TEXT NOT NULL DEFAULT '',
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  linked_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_review_links_client
  ON client_review_links (tenant_id, branch_id, client_id, reviewed_at DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_review_links_external
  ON client_review_links (tenant_id, branch_id, platform, external_review_id)
  WHERE external_review_id <> '';

CREATE TABLE IF NOT EXISTS client_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_audit_events_client
  ON client_audit_events (tenant_id, branch_id, client_id, created_at DESC);

ALTER TABLE client_treatment_photos
  ADD COLUMN IF NOT EXISTS photo_type TEXT NOT NULL DEFAULT 'other'
    CHECK (photo_type IN ('before','after','other'));

ALTER TABLE benefit_notification_outbox
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;

UPDATE benefit_notification_outbox outbox
SET client_id = reminder.client_id
FROM membership_reminders reminder
WHERE outbox.client_id IS NULL
  AND outbox.source_type = 'membership_reminder'
  AND reminder.tenant_id = outbox.tenant_id
  AND reminder.branch_id = outbox.branch_id
  AND reminder.id = outbox.source_id;

UPDATE benefit_notification_outbox outbox
SET client_id = credit.client_id
FROM client_package_credits credit
WHERE outbox.client_id IS NULL
  AND outbox.source_type = 'package_alert'
  AND credit.tenant_id = outbox.tenant_id
  AND credit.branch_id = outbox.branch_id
  AND credit.id = SPLIT_PART(outbox.source_id, ':', 1);

ALTER TABLE pos_invoice_outbox DROP CONSTRAINT IF EXISTS pos_invoice_outbox_status_check;
ALTER TABLE pos_invoice_outbox ADD CONSTRAINT pos_invoice_outbox_status_check
  CHECK (status IN ('queued','processing','sent','failed','blocked'));
ALTER TABLE benefit_notification_outbox DROP CONSTRAINT IF EXISTS benefit_notification_outbox_status_check;
ALTER TABLE benefit_notification_outbox ADD CONSTRAINT benefit_notification_outbox_status_check
  CHECK (status IN ('queued','processing','sent','failed','blocked'));
