-- Maps a receiving WhatsApp business number to the tenant and branch it serves.
--
-- Inbound routing previously worked backwards: it looked the *sender* up in
-- `clients` and adopted whatever tenant and branch that row happened to carry.
-- That makes the sender's own record decide which tenant's data the message is
-- answered from, and it leaves anyone who is not a client — a staff member
-- messaging their own branch, for one — with no tenant at all.
--
-- The receiving number is the correct anchor: a business number belongs to
-- exactly one branch, is provisioned by the operator, and cannot be changed by
-- whoever sends a message to it.

CREATE TABLE IF NOT EXISTS whatsapp_business_numbers (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id            TEXT NOT NULL,
  branch_id            TEXT NOT NULL,
  -- The provider's stable identifier for the receiving number. Preferred over
  -- the display number, which is formatted for humans and can be re-rendered.
  phone_number_id      TEXT NOT NULL DEFAULT '',
  -- Digits only, no punctuation and no leading '+'.
  display_phone_number TEXT NOT NULL DEFAULT '',
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_whatsapp_business_numbers_identity
    CHECK (phone_number_id <> '' OR display_phone_number <> '')
);

-- One branch per receiving number: routing must never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_business_numbers_phone_number_id
  ON whatsapp_business_numbers (phone_number_id)
  WHERE phone_number_id <> '' AND active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_business_numbers_display
  ON whatsapp_business_numbers (display_phone_number)
  WHERE display_phone_number <> '' AND active;

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_numbers_tenant
  ON whatsapp_business_numbers (tenant_id, branch_id)
  WHERE active;
