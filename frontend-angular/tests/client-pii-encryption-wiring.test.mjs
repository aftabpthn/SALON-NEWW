import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const crypto = read('../../backend-rust/src/services/client_pii_crypto.rs');
const backfill = read('../../backend-rust/src/services/client_pii_backfill_service.rs');
const migration = read('../../backend-rust/migrations/0418_client_pii_encryption.sql');
const main = read('../../backend-rust/src/main.rs');
const securityRoute = read('../../backend-rust/src/routes/security.rs');
const clientsRoute = read('../../backend-rust/src/routes/clients.rs');

test('the encryption key and the blind index key are derived separately', () => {
  // The blind index key is exercised on every lookup and the encryption key
  // only when a record is read back, so they have very different exposure.
  // Sharing one would make the cheaper compromise yield the expensive one.
  assert.match(crypto, /const ENCRYPTION_LABEL: &\[u8\] = b"aurashine\/client-pii\/v1\/encryption";/);
  assert.match(crypto, /const BLIND_INDEX_LABEL: &\[u8\] = b"aurashine\/client-pii\/v1\/blind-index";/);
  assert.match(crypto, /fn derive_key\(master: &str, label: &\[u8\]\) -> \[u8; 32\]/);
  // One operator-supplied secret, already deployed — a second env var would get
  // set to a copy of the first.
  assert.match(crypto, /SECURITY_ENCRYPTION_KEY/);
});

test('ciphertext is randomised and blind indexes are deterministic', () => {
  // Both properties are load-bearing and they pull in opposite directions: a
  // deterministic ciphertext would be a free index into the table, and a
  // randomised blind index could not be looked up.
  assert.match(crypto, /OsRng\.fill_bytes\(&mut nonce_bytes\)/);
  const blindIndexBody = crypto.slice(
    crypto.indexOf('fn blind_index('),
    crypto.indexOf('pub fn phone_blind_index('),
  );
  assert.doesNotMatch(blindIndexBody, /OsRng|fill_bytes/);
  assert.match(blindIndexBody, /HmacSha256 as Mac/);
});

test('an absent contact detail stays absent', () => {
  // Encrypting "" would turn "no phone on file" into a stored value, and every
  // client without one would then collide against every other on the index.
  assert.match(crypto, /if plaintext\.is_empty\(\) \{\s*\n\s*return Ok\(String::new\(\)\);/);
  assert.match(crypto, /if canonical\.is_empty\(\) \{\s*\n\s*return String::new\(\);/);
});

test('what replaces plaintext search is stored in the clear on purpose', () => {
  // Encrypting phone and email without these would break the two lookups the
  // product actually runs, and a control that breaks the workflow gets removed.
  assert.match(migration, /phone_last_four TEXT NOT NULL DEFAULT ''/);
  assert.match(migration, /email_domain TEXT NOT NULL DEFAULT ''/);
  assert.match(crypto, /fn last_four\(canonical_phone: &str\)/);
  assert.match(crypto, /fn email_domain\(canonical: &str\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_clients_phone_last_four/);
});

test('plaintext is kept until cutover, not swapped underneath the reads', () => {
  // 263 query sites touch this table. Dropping phone and email in the same
  // migration that adds the ciphertext is how a CRM loses its client list.
  assert.doesNotMatch(migration, /DROP COLUMN/);
  assert.doesNotMatch(migration, /ALTER TABLE clients[\s\S]{0,400}?DROP/);
  // And the blind index is not UNIQUE yet — the plaintext index still enforces
  // that, and two constraints on one fact would fail during the backfill.
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX[\s\S]{0,80}?blind_index/);
});

test('a plaintext change invalidates the ciphertext in the database', () => {
  // Clients are written from about a dozen places. A missed update path is
  // worse than a missed insert: the row still looks finished, so the backfill
  // skips it and the wrong number survives cutover. Postgres cannot encrypt,
  // but it can always see the value move.
  assert.match(migration, /CREATE OR REPLACE FUNCTION clients_invalidate_pii_encryption/);
  assert.match(migration, /NEW\.phone IS DISTINCT FROM OLD\.phone/);
  assert.match(migration, /NEW\.email IS DISTINCT FROM OLD\.email/);
  assert.match(migration, /NEW\.pii_encrypted_at := NULL;/);
  assert.match(migration, /BEFORE UPDATE ON clients/);
  // An explicit re-encrypt must not be undone by its own update and bounced
  // back into the queue forever.
  assert.match(migration, /NEW\.pii_encrypted_at IS NOT DISTINCT FROM OLD\.pii_encrypted_at/);
});

test('the backfill is bounded, resumable and survives a bad row', () => {
  assert.match(backfill, /const BATCH_SIZE: i64 = 500;/);
  assert.match(backfill, /WHERE pii_encrypted_at IS NULL OR pii_key_version < \$1/);
  // One unreadable client must not stop the other 499; a stalled backfill is
  // invisible because the CRM keeps working off plaintext.
  assert.match(backfill, /else \{\s*\n\s*continue;\s*\n\s*\};/);
  assert.match(main, /"client_pii_backfill"/);
  assert.match(main, /if state\.settings\.security_encryption_key\.is_some\(\)/);
});

test('key rotation reuses the backfill instead of a one-off script', () => {
  assert.match(crypto, /pub const KEY_VERSION: i32 = 1;/);
  assert.match(migration, /pii_key_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(backfill, /pii_key_version < \$1/);
});

test('cutover readiness is reported, not guessed', () => {
  // Once plaintext is dropped, a row that was never encrypted is a client
  // nobody can find. That decision needs numbers behind it.
  assert.match(backfill, /pub struct BackfillStatus/);
  assert.match(backfill, /pub ready_for_cutover: bool,/);
  assert.match(backfill, /encryption_configured && pending == 0 && collisions == 0/);
  assert.match(securityRoute, /"\/security\/client-encryption"/);
  assert.match(securityRoute, /require_security_read\(&claims\)\?;/);
});

test('normalisation collisions are surfaced before they can break the cutover', () => {
  // Plaintext uniqueness compared what was typed, so "9876543210" and
  // "+919876543210" were two rows. Normalised they are one number — the right
  // answer, and a duplicate a human has to merge before uniqueness can move to
  // the blind index.
  assert.match(backfill, /pub phone_collisions: i64,/);
  assert.match(backfill, /GROUP BY tenant_id, phone_blind_index/);
  assert.match(backfill, /HAVING COUNT\(\*\) > 1/);
});

test('a missing key degrades rather than taking the front desk down', () => {
  // Encryption is optional until cutover; refusing to save a client because a
  // secret is unset would be a worse outage than the risk it addresses.
  assert.match(backfill, /let Some\(key\) = master_key\.filter\(\|key\| !key\.is_empty\(\)\) else \{\s*\n\s*return Ok\(\(\)\);/);
  assert.match(clientsRoute, /client_pii_backfill_service::encrypt_client\(/);
});
