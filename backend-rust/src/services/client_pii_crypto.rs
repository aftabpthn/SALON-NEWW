//! Encryption and blind indexing for client contact details.
//!
//! `clients.phone` and `clients.email` are the columns a stolen database dump
//! is worth stealing for. Everything else in the row is context; a phone number
//! and an email address are the identifiers themselves.
//!
//! Encrypting them is easy. Keeping the CRM usable afterwards is the work, so
//! each derived value here exists to replace one thing plaintext was doing:
//!
//! | Derived            | Replaces                                    |
//! |--------------------|---------------------------------------------|
//! | `ciphertext`       | Reading the value back                      |
//! | `blind_index`      | Exact lookup, and the phone uniqueness rule |
//! | `phone_last_four`  | "…4321" search at the front desk            |
//! | `email_domain`     | Marketing segmentation by domain            |
//!
//! Substring search over the middle of a number or the local part of an address
//! is given up, on purpose. That capability is what lets somebody walk the whole
//! table, so no scheme keeps both it and confidentiality.
//!
//! # Keys
//!
//! One secret, `SECURITY_ENCRYPTION_KEY`, already deployed for MFA secrets and
//! staff statutory identifiers. Two keys are derived from it under distinct
//! labels, so recovering the blind index key tells an attacker nothing about
//! the encryption key and vice versa — the two have very different exposure:
//! the blind index key is used on every lookup, the encryption key only when a
//! record is actually read back.
//!
//! Asking operators for a second secret would get one of the two set to a copy
//! of the other, which is the failure this avoids.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use rand_core::RngCore;
use sha2::Sha256;

use crate::{models::common::AppError, services::client_service};

type HmacSha256 = Hmac<Sha256>;

/// Bumped when a derivation changes or the master key is rotated.
///
/// Rows carry the version they were derived under, and the backfill re-derives
/// anything behind it. Rotation is therefore the same code path as the first
/// fill, not a separate one-off script written under pressure.
pub const KEY_VERSION: i32 = 1;

const ENCRYPTION_LABEL: &[u8] = b"aurashine/client-pii/v1/encryption";
const BLIND_INDEX_LABEL: &[u8] = b"aurashine/client-pii/v1/blind-index";

/// Everything derived from one client's contact details.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EncryptedContact {
    pub phone_ciphertext: String,
    pub phone_blind_index: String,
    pub phone_last_four: String,
    pub email_ciphertext: String,
    pub email_blind_index: String,
    pub email_domain: String,
}

fn missing_key() -> AppError {
    AppError::service_unavailable(
        "CLIENT_PII_ENCRYPTION_NOT_CONFIGURED",
        "client data encryption is not configured",
    )
}

/// Splits the master secret into two independent keys.
///
/// HMAC with a fixed label per purpose: the standard extract step, and enough
/// on its own here because the master secret is already required to be at least
/// 32 characters of real entropy by config validation.
fn derive_key(master: &str, label: &[u8]) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(master.as_bytes())
        .expect("HMAC-SHA256 accepts keys of any length");
    mac.update(label);
    let mut key = [0_u8; 32];
    key.copy_from_slice(&mac.finalize().into_bytes());
    key
}

/// Canonical form of a value before it is hashed or encrypted.
///
/// Two spellings of one address must produce one blind index, or a duplicate
/// slips in the moment somebody types `Priya@Example.COM `. Phones go through
/// the same normaliser the rest of the product already uses.
fn canonical_email(raw: &str) -> String {
    raw.trim().to_lowercase()
}

/// The domain part, or empty when the address is not one.
///
/// Kept in the clear: segmentation by domain is a marketing feature, and a
/// domain identifies a mail provider rather than a person.
fn email_domain(canonical: &str) -> String {
    match canonical.rsplit_once('@') {
        Some((local, domain)) if !local.is_empty() && domain.contains('.') => domain.to_string(),
        _ => String::new(),
    }
}

/// The last four digits, which is what a front desk search actually types.
///
/// Four digits out of ten identify nobody by themselves; the card networks
/// print them on receipts for the same reason.
fn last_four(canonical_phone: &str) -> String {
    let digits: String = canonical_phone
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    if digits.len() < 4 {
        return String::new();
    }
    digits[digits.len() - 4..].to_string()
}

/// AES-256-GCM, nonce prepended, base64url.
///
/// A fresh random nonce per call, so the same phone number encrypts differently
/// every time — otherwise the ciphertext would itself be a deterministic index
/// and the blind index key would be pointless.
pub fn encrypt(master_key: &str, plaintext: &str) -> Result<String, AppError> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let cipher = Aes256Gcm::new_from_slice(&derive_key(master_key, ENCRYPTION_LABEL))
        .map_err(|_| AppError::internal("failed to initialise client data encryption"))?;
    let mut nonce_bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|_| AppError::internal("failed to encrypt client contact details"))?;
    let mut stored = nonce.to_vec();
    stored.extend(ciphertext);
    Ok(URL_SAFE_NO_PAD.encode(stored))
}

/// Reverses [`encrypt`]. An empty stored value decrypts to an empty string.
pub fn decrypt(master_key: &str, stored: &str) -> Result<String, AppError> {
    if stored.is_empty() {
        return Ok(String::new());
    }
    let raw = URL_SAFE_NO_PAD
        .decode(stored)
        .map_err(|_| AppError::internal("stored client contact details are unreadable"))?;
    if raw.len() <= 12 {
        return Err(AppError::internal(
            "stored client contact details are unreadable",
        ));
    }
    let cipher = Aes256Gcm::new_from_slice(&derive_key(master_key, ENCRYPTION_LABEL))
        .map_err(|_| AppError::internal("failed to initialise client data encryption"))?;
    let nonce: [u8; 12] = raw[..12]
        .try_into()
        .map_err(|_| AppError::internal("stored client contact details are unreadable"))?;
    let plaintext = cipher
        .decrypt(&Nonce::from(nonce), &raw[12..])
        .map_err(|_| AppError::internal("failed to decrypt client contact details"))?;
    String::from_utf8(plaintext)
        .map_err(|_| AppError::internal("stored client contact details are unreadable"))
}

/// Keyed, deterministic index over a canonical value.
///
/// Deterministic so exact lookup and the phone uniqueness rule survive
/// encryption. Keyed so a dump cannot be walked: without the key, hashing every
/// Indian mobile number — about a billion of them, minutes of work against a
/// plain digest — yields nothing.
fn blind_index(master_key: &str, canonical: &str) -> String {
    if canonical.is_empty() {
        return String::new();
    }
    let mut mac = <HmacSha256 as Mac>::new_from_slice(&derive_key(master_key, BLIND_INDEX_LABEL))
        .expect("HMAC-SHA256 accepts keys of any length");
    mac.update(canonical.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

/// Blind index for a phone number as the user typed it.
///
/// Normalisation runs first and failures fall back to the trimmed digits rather
/// than erroring: a lookup for a number the validator would reject should return
/// nothing, not a 400.
pub fn phone_blind_index(master_key: &str, raw_phone: &str) -> String {
    blind_index(master_key, &canonical_phone(raw_phone))
}

/// Blind index for an email address as the user typed it.
pub fn email_blind_index(master_key: &str, raw_email: &str) -> String {
    blind_index(master_key, &canonical_email(raw_email))
}

fn canonical_phone(raw: &str) -> String {
    client_service::normalize_phone(raw).unwrap_or_else(|_| {
        let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
        if digits.is_empty() {
            String::new()
        } else {
            format!("+{digits}")
        }
    })
}

/// Derives every stored column for one client's contact details.
pub fn encrypt_contact(
    master_key: &str,
    raw_phone: &str,
    raw_email: &str,
) -> Result<EncryptedContact, AppError> {
    let phone = canonical_phone(raw_phone);
    let email = canonical_email(raw_email);
    Ok(EncryptedContact {
        phone_ciphertext: encrypt(master_key, &phone)?,
        phone_blind_index: blind_index(master_key, &phone),
        phone_last_four: last_four(&phone),
        email_ciphertext: encrypt(master_key, &email)?,
        email_blind_index: blind_index(master_key, &email),
        email_domain: email_domain(&email),
    })
}

/// The configured master key, or a typed error naming what is missing.
///
/// Callers that can carry on without encryption should check
/// [`enabled`] instead of treating this error as fatal.
pub fn require_key(configured: Option<&str>) -> Result<&str, AppError> {
    configured
        .filter(|key| !key.is_empty())
        .ok_or_else(missing_key)
}

/// Whether client PII encryption can run at all.
pub fn enabled(configured: Option<&str>) -> bool {
    configured.is_some_and(|key| !key.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "test-master-key-with-at-least-32-characters";

    #[test]
    fn the_two_derived_keys_are_independent() {
        // If one label produced both, recovering the blind index key — the one
        // exercised on every single lookup — would hand over the encryption key
        // and every record with it.
        let encryption = derive_key(KEY, ENCRYPTION_LABEL);
        let index = derive_key(KEY, BLIND_INDEX_LABEL);
        assert_ne!(encryption, index);
        // And neither is the master secret sitting there unchanged.
        assert_ne!(&encryption[..], &KEY.as_bytes()[..32]);
    }

    #[test]
    fn a_different_master_key_changes_everything() {
        let other = "another-master-key-with-32-plus-characters";
        assert_ne!(
            derive_key(KEY, ENCRYPTION_LABEL),
            derive_key(other, ENCRYPTION_LABEL)
        );
        assert_ne!(
            phone_blind_index(KEY, "+919876543210"),
            phone_blind_index(other, "+919876543210")
        );
    }

    #[test]
    fn encryption_round_trips() {
        let stored = encrypt(KEY, "+919876543210").unwrap();
        assert_eq!(decrypt(KEY, &stored).unwrap(), "+919876543210");
    }

    #[test]
    fn the_same_number_encrypts_differently_every_time() {
        // A deterministic ciphertext would be a free index into the table, which
        // is the whole thing the blind index key is there to prevent.
        let first = encrypt(KEY, "+919876543210").unwrap();
        let second = encrypt(KEY, "+919876543210").unwrap();
        assert_ne!(first, second);
        assert_eq!(
            decrypt(KEY, &first).unwrap(),
            decrypt(KEY, &second).unwrap()
        );
    }

    #[test]
    fn the_wrong_key_fails_rather_than_returning_rubbish() {
        // GCM authenticates; a silent wrong-key decode would corrupt records.
        let stored = encrypt(KEY, "priya@example.com").unwrap();
        assert!(decrypt("a-completely-different-key-32-chars-long", &stored).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let stored = encrypt(KEY, "+919876543210").unwrap();
        let mut bytes = URL_SAFE_NO_PAD.decode(&stored).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;
        assert!(decrypt(KEY, &URL_SAFE_NO_PAD.encode(bytes)).is_err());
    }

    #[test]
    fn an_absent_value_stays_absent() {
        // Encrypting "" would turn "no phone on file" into something that looks
        // like a stored number, and the uniqueness rule would then collide every
        // client without one against every other.
        let contact = encrypt_contact(KEY, "", "").unwrap();
        assert_eq!(contact, EncryptedContact::default());
        assert_eq!(decrypt(KEY, "").unwrap(), "");
    }

    #[test]
    fn one_number_written_five_ways_has_one_blind_index() {
        // Otherwise the same guest is created twice the first time somebody
        // types the country code differently.
        let expected = phone_blind_index(KEY, "+919876543210");
        for spelling in [
            "9876543210",
            "+91 98765 43210",
            "+91-98765-43210",
            "0091 9876543210",
            " +919876543210 ",
        ] {
            assert_eq!(phone_blind_index(KEY, spelling), expected, "{spelling}");
        }
    }

    #[test]
    fn addresses_are_matched_case_insensitively() {
        assert_eq!(
            email_blind_index(KEY, "Priya@Example.COM"),
            email_blind_index(KEY, " priya@example.com ")
        );
    }

    #[test]
    fn different_values_do_not_collide() {
        assert_ne!(
            phone_blind_index(KEY, "+919876543210"),
            phone_blind_index(KEY, "+919876543211")
        );
        assert_ne!(
            email_blind_index(KEY, "priya@example.com"),
            email_blind_index(KEY, "priya@example.net")
        );
    }

    #[test]
    fn the_last_four_are_what_the_front_desk_types() {
        assert_eq!(last_four("+919876543210"), "3210");
        assert_eq!(last_four("+91 98765 43210"), "3210");
        // Nothing to show is better than showing a partial number.
        assert_eq!(last_four("123"), "");
        assert_eq!(last_four(""), "");
    }

    #[test]
    fn the_domain_is_kept_but_the_person_is_not() {
        assert_eq!(email_domain("priya@example.com"), "example.com");
        // Not an address: storing the whole string as a "domain" would leak it.
        assert_eq!(email_domain("not-an-address"), "");
        assert_eq!(email_domain("@example.com"), "");
        assert_eq!(email_domain("priya@localhost"), "");
        assert_eq!(email_domain(""), "");
    }

    #[test]
    fn a_full_contact_derives_every_column() {
        let contact = encrypt_contact(KEY, "98765 43210", "Priya@Example.com").unwrap();
        assert_eq!(
            decrypt(KEY, &contact.phone_ciphertext).unwrap(),
            "+919876543210"
        );
        assert_eq!(
            decrypt(KEY, &contact.email_ciphertext).unwrap(),
            "priya@example.com"
        );
        assert_eq!(contact.phone_last_four, "3210");
        assert_eq!(contact.email_domain, "example.com");
        assert!(!contact.phone_blind_index.is_empty());
        assert!(!contact.email_blind_index.is_empty());
    }

    #[test]
    fn a_number_the_validator_rejects_still_looks_up_instead_of_erroring() {
        // Searching for something malformed should find nothing, not 400.
        let index = phone_blind_index(KEY, "12");
        assert!(!index.is_empty());
        assert_ne!(index, phone_blind_index(KEY, "+919876543210"));
        assert!(phone_blind_index(KEY, "").is_empty());
    }

    #[test]
    fn an_unconfigured_key_is_reported_rather_than_defaulted() {
        // Falling back to a built-in key would encrypt every tenant under a
        // secret that ships in the binary.
        assert!(!enabled(None));
        assert!(!enabled(Some("")));
        assert!(enabled(Some(KEY)));
        assert!(require_key(None).is_err());
        assert_eq!(require_key(Some(KEY)).unwrap(), KEY);
    }
}
