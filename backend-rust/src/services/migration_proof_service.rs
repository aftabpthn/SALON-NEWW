use chrono::Utc;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::models::common::AppError;

pub fn sign(pack: &mut Value, key: &str) -> Result<(), AppError> {
    if key.as_bytes().len() < 32 {
        return Err(AppError::internal(
            "migration proof signing key must contain at least 32 bytes",
        ));
    }
    let payload = pack.to_string();
    let payload_sha256 = format!("{:x}", Sha256::digest(payload.as_bytes()));
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes())
        .map_err(|_| AppError::internal("invalid migration proof signing key"))?;
    mac.update(payload.as_bytes());
    let signature = format!("{:x}", mac.finalize().into_bytes());
    let key_id = format!("{:x}", Sha256::digest(key.as_bytes()))[..16].to_string();
    pack.as_object_mut()
        .ok_or_else(|| AppError::internal("migration proof pack is invalid"))?
        .insert(
            "signature".into(),
            json!({
                "algorithm": "HMAC-SHA256",
                "keyId": key_id,
                "keyManagement": "environment-secret-or-external-KMS-injection",
                "payloadSha256": payload_sha256,
                "value": signature,
                "signedAt": Utc::now()
            }),
        );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proof_signature_changes_when_payload_changes() {
        let mut first = json!({"job":"one"});
        let mut second = json!({"job":"two"});
        sign(&mut first, "01234567890123456789012345678901").unwrap();
        sign(&mut second, "01234567890123456789012345678901").unwrap();
        assert_ne!(first["signature"]["value"], second["signature"]["value"]);
        assert_eq!(first["signature"]["algorithm"], "HMAC-SHA256");
        assert_eq!(
            first["signature"]["keyManagement"],
            "environment-secret-or-external-KMS-injection"
        );
        assert!(sign(&mut json!({"job":"unsafe"}), "too-short").is_err());
    }
}
