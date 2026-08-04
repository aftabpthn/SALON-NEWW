-- Encryption at rest for the two client identifiers that actually matter.
--
-- clients.phone and clients.email sit in plaintext, and they are the columns a
-- stolen dump is worth stealing for: a phone number and an email address are
-- what a competitor buys, what a spammer uses and what an attacker needs to
-- start an account takeover. A first name is not.
--
-- So the ciphertext lives here alongside the plaintext, not instead of it yet.
-- Nothing reads these columns until the backfill has covered every row and an
-- operator has checked that it has; only then does the plaintext go. Swapping
-- both at once across 263 query sites is how a CRM loses its client list.
--
-- What replaces plaintext search:
--
--   * A blind index — HMAC of the normalised value under a key derived from
--     SECURITY_ENCRYPTION_KEY. Deterministic, so exact lookup and the phone
--     uniqueness constraint both survive; keyed, so a dump cannot be walked by
--     hashing candidate numbers.
--   * The last four digits of the phone, in the clear. A receptionist searching
--     "…4321" is the single most common lookup in the product, and four digits
--     out of ten identify nobody on their own. The same trade the card networks
--     make, for the same reason.
--   * The email domain, in the clear, because segmentation by domain is a
--     marketing feature and a domain is not personal data.
--
-- What is deliberately given up: substring search over the middle of a phone
-- number or the local part of an address. That is also precisely the capability
-- that lets someone walk the table, which is why no scheme keeps both.

ALTER TABLE clients
  -- AES-256-GCM, nonce prepended, base64url. Empty when the source value is
  -- empty, so an absent phone stays absent rather than becoming a ciphertext.
  ADD COLUMN IF NOT EXISTS phone_ciphertext TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone_blind_index TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone_last_four TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_ciphertext TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_blind_index TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_domain TEXT NOT NULL DEFAULT '',
  -- Set when the row's ciphertext was last derived. NULL means the backfill has
  -- not reached this row, which is what the readiness check counts and what
  -- stops the read flip from happening early.
  ADD COLUMN IF NOT EXISTS pii_encrypted_at TIMESTAMPTZ,
  -- Which derivation produced the values above. A key rotation bumps this and
  -- the backfill re-derives every row that is behind, so rotation is the same
  -- code path as the first fill rather than a separate migration.
  ADD COLUMN IF NOT EXISTS pii_key_version INTEGER NOT NULL DEFAULT 0;

-- Exact lookup by phone and email, and the replacement for
-- idx_clients_tenant_phone once plaintext goes. Not declared UNIQUE here: the
-- existing plaintext unique index is still the one enforcing it, and two
-- constraints on the same fact would fail confusingly during the backfill.
CREATE INDEX IF NOT EXISTS idx_clients_phone_blind_index
  ON clients (tenant_id, phone_blind_index)
  WHERE phone_blind_index <> '';

CREATE INDEX IF NOT EXISTS idx_clients_email_blind_index
  ON clients (tenant_id, email_blind_index)
  WHERE email_blind_index <> '';

-- The receptionist's "…4321" lookup, scoped to a branch so it stays selective.
CREATE INDEX IF NOT EXISTS idx_clients_phone_last_four
  ON clients (tenant_id, branch_id, phone_last_four)
  WHERE phone_last_four <> '';

-- Drives the backfill: the rows still behind the current key version, oldest
-- first. Partial on the trailing condition so it shrinks to nothing as the
-- backfill completes rather than staying the size of the table.
CREATE INDEX IF NOT EXISTS idx_clients_pii_pending
  ON clients (tenant_id, created_at)
  WHERE pii_encrypted_at IS NULL;

-- Any change to the plaintext invalidates the ciphertext.
--
-- Clients are written from roughly a dozen places — the CRM, the customer
-- portal, bulk import, invoice webhooks, AI tools — and asking every one of
-- them to remember to re-encrypt is asking to be forgotten by one of them. A
-- forgotten update path is worse than a forgotten insert: the row still looks
-- finished, so the backfill skips it and the stale ciphertext survives cutover
-- as a client whose phone number is quietly wrong.
--
-- Postgres cannot do the encrypting — the key is deliberately not here — but it
-- can always tell that the value moved. So it clears the marker and the worker
-- re-derives within the next batch. No call site can get this wrong by omission.
CREATE OR REPLACE FUNCTION clients_invalidate_pii_encryption()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    -- Only when the application did not already supply fresh values in the same
    -- statement, so an explicit re-encrypt is not immediately undone by its own
    -- update and bounced back into the queue forever.
    IF NEW.pii_encrypted_at IS NOT DISTINCT FROM OLD.pii_encrypted_at THEN
      NEW.pii_encrypted_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_invalidate_pii_encryption ON clients;
CREATE TRIGGER trg_clients_invalidate_pii_encryption
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION clients_invalidate_pii_encryption();
