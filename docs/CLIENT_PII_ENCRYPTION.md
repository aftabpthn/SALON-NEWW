# Client contact encryption

`clients.phone` and `clients.email` are the columns a stolen database dump is
worth stealing for. Everything else on the row is context; a phone number and an
email address are the identifiers themselves — what a competitor buys, what a
spammer uses, what an attacker needs to start an account takeover.

They are now encrypted at rest, **alongside** the plaintext rather than instead
of it. This document covers why it is staged that way, and what the second stage
requires.

## What is stored

| Column | Contents | Why |
|---|---|---|
| `phone_ciphertext`, `email_ciphertext` | AES-256-GCM, random nonce prepended, base64url | The value itself |
| `phone_blind_index`, `email_blind_index` | HMAC-SHA256 of the normalised value | Exact lookup, and the phone uniqueness rule |
| `phone_last_four` | Four digits, in the clear | The front desk's "…4321" search |
| `email_domain` | Domain part, in the clear | Marketing segmentation |
| `pii_encrypted_at`, `pii_key_version` | When and under which key | Drives the backfill and rotation |

### What is deliberately given up

Substring search over the middle of a phone number, and over the local part of
an email address. Those are exactly the capability that lets someone walk the
whole table one query at a time, which is why no scheme keeps both them and
confidentiality.

The lookups the product actually runs are preserved: a full number or address
resolves through the blind index, the last four digits through their own
column, and names were never encrypted so name search is untouched.

### Why names are not encrypted

A first name is not what makes a dump valuable, and encrypting it would collapse
fuzzy name search — the single most used query in the CRM — to exact match. The
trade is bad in both directions. If that changes, the machinery here extends to
another column without redesign.

## Keys

One secret, `SECURITY_ENCRYPTION_KEY`, already deployed for MFA secrets and
staff statutory identifiers. Two keys are derived from it under distinct labels:

```
encryption key  = HMAC(master, "aurashine/client-pii/v1/encryption")
blind index key = HMAC(master, "aurashine/client-pii/v1/blind-index")
```

Separate because their exposure is very different — the blind index key is used
on every lookup, the encryption key only when a record is read back — so the
cheaper compromise must not yield the expensive one. Derived rather than asked
for as a second environment variable, because a second variable gets set to a
copy of the first.

**Losing the master key makes every encrypted value unrecoverable.** It is not
in the database, by design.

## How rows get filled

Two mechanisms, and the second is the one that makes this safe:

1. **The `client_pii_backfill` worker**, every 120 seconds, 500 rows a pass. It
   picks up anything with `pii_encrypted_at IS NULL` or a key version behind
   the current one. A row that cannot be encrypted is skipped rather than
   stalling the batch.

2. **A database trigger** that clears `pii_encrypted_at` whenever `phone` or
   `email` changes. Clients are written from about a dozen places — the CRM, the
   customer portal, bulk import, invoice webhooks, AI tools — and asking each one
   to remember to re-encrypt is asking to be forgotten by one of them. A
   forgotten *update* path is worse than a forgotten insert: the row still looks
   finished, so the backfill skips it and a stale phone number survives cutover.

   Postgres cannot do the encrypting, since the key is deliberately not there.
   It can always tell that the value moved, which is enough.

Client creation at the counter also encrypts inline, so a new guest is
searchable immediately rather than up to two minutes later.

## Rotation

Bump `KEY_VERSION` in `client_pii_crypto.rs`. Every row is then behind, and the
same worker re-derives them. There is no separate rotation script.

Note that rotation only re-derives; it does not re-key already-issued values in
place, so plan it while plaintext is still present (i.e. before stage 2) or
accept a window where old and new versions coexist and lookups must try both.

## Stage 2: cutover

**Not yet done, and not to be done on a schedule.** Cutover means moving reads
off plaintext and dropping the columns. After that, a client whose row was never
encrypted is a client nobody can find.

Preconditions, all reported by `GET /security/client-encryption`:

- `encryptionConfigured` is true.
- `pendingClients` is 0 — every row is current under `KEY_VERSION`.
- `phoneCollisions` is 0.

That last one needs explaining. Plaintext uniqueness compared what was *typed*,
so `9876543210` and `+919876543210` were two different rows for two different
people as far as the database was concerned. Normalisation makes them one
number, which is the correct answer and also a duplicate. Those pairs have to be
merged by hand before uniqueness can move onto the blind index; attempting the
unique index with duplicates present fails the migration and leaves the table
half-cut-over.

The order, once those hold:

1. Rewrite the read paths against `phone_blind_index` / `phone_last_four` /
   `email_blind_index`, decrypting for display. Ship and verify with plaintext
   still present, so a mistake is a bug rather than an outage.
2. Add `UNIQUE` to the phone blind index, drop `idx_clients_tenant_phone`.
3. Rebuild `idx_clients_search_trigram` without `phone`, `normalized_phone` and
   `email` in the concatenation.
4. Only then drop `clients.phone`, `clients.normalized_phone` and
   `clients.email`.

Steps 1 and 4 must not be in the same deployment.
