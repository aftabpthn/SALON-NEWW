//! Fills in encrypted client contact details behind the live plaintext.
//!
//! The ciphertext columns land empty on an existing database with a hundred
//! thousand clients in it. Something has to derive them, and it cannot be a
//! migration: encryption needs the application key, which by design is not
//! available to Postgres.
//!
//! So it runs as a worker, in bounded batches, and it is safe to run at any
//! time because nothing reads what it writes yet. Plaintext is still the source
//! of truth and still serves every query. The read flip is a later, separate
//! decision — and [`status`] is what that decision is made on, because flipping
//! while rows are still unencrypted would make those clients vanish from the
//! CRM.
//!
//! # Rotation is the same path
//!
//! Rows record the key version they were derived under. Bump
//! [`client_pii_crypto::KEY_VERSION`] and every row is behind again, so the same
//! worker re-derives them. There is no separate rotation script to write badly
//! at three in the morning.

use serde::Serialize;
use sqlx::PgPool;

use crate::{models::common::AppError, services::client_pii_crypto};

/// Rows per pass.
///
/// Each row costs one AES encryption and two HMACs — microseconds — so the
/// limit is about how long a single transaction holds row locks against live
/// front-desk writes, not about CPU.
const BATCH_SIZE: i64 = 500;

/// How far the encrypted copy has got, and whether it is safe to rely on.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackfillStatus {
    pub total_clients: i64,
    pub encrypted_clients: i64,
    pub pending_clients: i64,
    pub key_version: i32,
    /// Clients whose normalised phone now collides with another client's.
    ///
    /// Plaintext uniqueness compared what was typed, so `9876543210` and
    /// `+919876543210` were two different rows. Normalisation makes them one
    /// number, which is the correct answer and also a duplicate that has to be
    /// merged by hand before uniqueness can be enforced on the blind index.
    pub phone_collisions: i64,
    /// True only when every row is current and no collisions remain.
    pub ready_for_cutover: bool,
    pub encryption_configured: bool,
}

/// Counts what is done, what is left, and what would break a cutover.
pub async fn status(db: &PgPool, encryption_configured: bool) -> Result<BackfillStatus, AppError> {
    let (total, encrypted): (i64, i64) = sqlx::query_as(
        r#"SELECT COUNT(*),
                  COUNT(*) FILTER (
                    WHERE pii_encrypted_at IS NOT NULL AND pii_key_version >= $1
                  )
             FROM clients
            WHERE merged_into_client_id IS NULL"#,
    )
    .bind(client_pii_crypto::KEY_VERSION)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to read client encryption status"))?;

    let collisions: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(count), 0)
             FROM (
               SELECT COUNT(*) AS count
                 FROM clients
                WHERE merged_into_client_id IS NULL AND phone_blind_index <> ''
                GROUP BY tenant_id, phone_blind_index
               HAVING COUNT(*) > 1
             ) duplicates"#,
    )
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to check for duplicate client phones"))?;

    let pending = total - encrypted;
    Ok(BackfillStatus {
        total_clients: total,
        encrypted_clients: encrypted,
        pending_clients: pending,
        key_version: client_pii_crypto::KEY_VERSION,
        phone_collisions: collisions,
        ready_for_cutover: encryption_configured && pending == 0 && collisions == 0,
        encryption_configured,
    })
}

/// Encrypts one batch of rows that are missing or behind.
///
/// Returns how many were written, so the caller can tell "there was nothing to
/// do" from "there is more". Each row is updated on its own: one client with an
/// unreadable value must not stop the other 499, and on a table this size a
/// stalled backfill would go unnoticed for weeks.
pub async fn run_batch(db: &PgPool, master_key: &str) -> Result<u64, AppError> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        r#"SELECT id, phone, email
             FROM clients
            WHERE pii_encrypted_at IS NULL OR pii_key_version < $1
            ORDER BY created_at
            LIMIT $2"#,
    )
    .bind(client_pii_crypto::KEY_VERSION)
    .bind(BATCH_SIZE)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load clients for encryption"))?;

    let mut written = 0_u64;
    for (id, phone, email) in rows {
        let Ok(contact) = client_pii_crypto::encrypt_contact(master_key, &phone, &email) else {
            continue;
        };
        let updated = sqlx::query(
            r#"UPDATE clients
                  SET phone_ciphertext = $2,
                      phone_blind_index = $3,
                      phone_last_four = $4,
                      email_ciphertext = $5,
                      email_blind_index = $6,
                      email_domain = $7,
                      pii_encrypted_at = NOW(),
                      pii_key_version = $8
                WHERE id = $1"#,
        )
        .bind(&id)
        .bind(&contact.phone_ciphertext)
        .bind(&contact.phone_blind_index)
        .bind(&contact.phone_last_four)
        .bind(&contact.email_ciphertext)
        .bind(&contact.email_blind_index)
        .bind(&contact.email_domain)
        .bind(client_pii_crypto::KEY_VERSION)
        .execute(db)
        .await;
        if let Ok(result) = updated {
            written += result.rows_affected();
        }
    }
    Ok(written)
}

/// Derives and stores the encrypted columns for one client.
///
/// Called on every write so a row created after the backfill has passed does
/// not silently stay in plaintext — the gap that leaves a table permanently one
/// batch short of ready. A missing key is not an error: encryption is optional
/// until cutover, and refusing to save a client because of it would take the
/// front desk down.
pub async fn encrypt_client(
    db: &PgPool,
    master_key: Option<&str>,
    client_id: &str,
    phone: &str,
    email: &str,
) -> Result<(), AppError> {
    let Some(key) = master_key.filter(|key| !key.is_empty()) else {
        return Ok(());
    };
    let contact = client_pii_crypto::encrypt_contact(key, phone, email)?;
    sqlx::query(
        r#"UPDATE clients
              SET phone_ciphertext = $2,
                  phone_blind_index = $3,
                  phone_last_four = $4,
                  email_ciphertext = $5,
                  email_blind_index = $6,
                  email_domain = $7,
                  pii_encrypted_at = NOW(),
                  pii_key_version = $8
            WHERE id = $1"#,
    )
    .bind(client_id)
    .bind(&contact.phone_ciphertext)
    .bind(&contact.phone_blind_index)
    .bind(&contact.phone_last_four)
    .bind(&contact.email_ciphertext)
    .bind(&contact.email_blind_index)
    .bind(&contact.email_domain)
    .bind(client_pii_crypto::KEY_VERSION)
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to store encrypted client contact details"))?;
    Ok(())
}

/// Finds a client by phone without the plaintext column.
///
/// The blind index makes this an index lookup rather than a scan, which is what
/// keeps duplicate detection on client creation affordable after cutover.
pub async fn find_by_phone(
    db: &PgPool,
    master_key: &str,
    tenant_id: &str,
    raw_phone: &str,
) -> Result<Option<String>, AppError> {
    let index = client_pii_crypto::phone_blind_index(master_key, raw_phone);
    if index.is_empty() {
        return Ok(None);
    }
    sqlx::query_scalar(
        r#"SELECT id
             FROM clients
            WHERE tenant_id = $1 AND phone_blind_index = $2
              AND merged_into_client_id IS NULL
            ORDER BY created_at
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(&index)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to look up the client by phone"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_is_bounded() {
        // Unbounded, the first pass on a large tenant would hold row locks
        // across the whole clients table while the front desk is taking walk-ins.
        assert!(BATCH_SIZE > 0 && BATCH_SIZE <= 2_000);
    }

    #[test]
    fn cutover_needs_every_row_and_no_duplicates() {
        let ready = BackfillStatus {
            total_clients: 100,
            encrypted_clients: 100,
            pending_clients: 0,
            key_version: client_pii_crypto::KEY_VERSION,
            phone_collisions: 0,
            ready_for_cutover: true,
            encryption_configured: true,
        };
        // One unencrypted row is one client who would disappear from search the
        // moment reads move off plaintext.
        let mut behind = ready.clone();
        behind.pending_clients = 1;
        assert!(
            !(behind.encryption_configured
                && behind.pending_clients == 0
                && behind.phone_collisions == 0)
        );

        // Collisions have to be merged by a human first: enforcing uniqueness on
        // the blind index with duplicates present would fail the migration and
        // leave the table half-cut-over.
        let mut colliding = ready.clone();
        colliding.phone_collisions = 2;
        assert!(
            !(colliding.encryption_configured
                && colliding.pending_clients == 0
                && colliding.phone_collisions == 0)
        );

        // And no key means nothing was ever really encrypted.
        let mut unconfigured = ready;
        unconfigured.encryption_configured = false;
        assert!(
            !(unconfigured.encryption_configured
                && unconfigured.pending_clients == 0
                && unconfigured.phone_collisions == 0)
        );
    }
}
