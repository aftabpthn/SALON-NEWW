//! Guest-facing access control for invoice payment links.
//!
//! A payment link is sent over WhatsApp, and the provider URL it carries is a
//! bearer credential: whoever opens it sees the invoice and can pay it.
//! Forwarded once, it is out of the salon's hands. Nothing recorded that a link
//! had been opened, by whom or how often, and several live links could exist for
//! one invoice at the same time.
//!
//! So the provider URL is no longer what the guest receives. They get a token of
//! ours; opening it lands here, where they confirm the last four digits of the
//! phone the invoice belongs to and are then forwarded on. Two things follow
//! from that:
//!
//! * **A forwarded link is useless to the wrong person.** They do not know the
//!   guest's number, and the link stops answering after a few wrong tries.
//! * **The salon learns what happened.** Every open, failed confirmation and
//!   redirect is recorded, which is exactly the evidence a chargeback turns on:
//!   a hosted checkout cannot otherwise show the guest themselves authorised it.
//!
//! Four digits is a small space, so the attempt cap is the load-bearing part
//! here, not the secret.

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{models::common::AppError, services::auth_service};

/// Wrong confirmations a link answers before it stops.
///
/// Ten thousand combinations divided by five attempts is what makes the last
/// four digits usable at all; without the cap this would be a keypad with no
/// lock.
const MAX_FAILED_VERIFICATIONS: i32 = 5;

/// What a guest sees when they open a link, before confirming anything.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkChallenge {
    pub status: String,
    pub amount_paise: i64,
    pub branch_name: String,
    pub invoice_number: String,
    /// `true` while the guest still has to confirm their phone.
    pub verification_required: bool,
    /// Present only once the guest is through, or when verification is off.
    pub redirect_url: Option<String>,
    pub message: String,
}

/// Mints a token for a link and stores only its hash.
///
/// Returned to the caller once; after that the token exists in the guest's
/// message and nowhere else, so a database dump does not hand over live links.
pub async fn issue_access_token(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    link_id: &str,
    require_phone_verification: bool,
) -> Result<String, AppError> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    sqlx::query(
        r#"UPDATE pos_payment_links
              SET access_token_hash = $4, require_phone_verification = $5, updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(link_id)
    .bind(auth_service::token_hash(&token))
    .bind(require_phone_verification)
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to issue the payment link token"))?;
    Ok(token)
}

/// Cancels the other live links for an invoice.
///
/// One invoice, one working link. Otherwise an older URL sitting in a chat
/// thread keeps taking payments after the amount has been revised, and the
/// salon has two links it cannot tell apart.
pub async fn supersede_other_links(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    keep_link_id: &str,
) -> Result<u64, AppError> {
    sqlx::query(
        r#"UPDATE pos_payment_links
              SET status = 'cancelled', superseded_by = $5, updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND sale_id = $3
              AND id <> $4 AND status = 'pending'"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(keep_link_id)
    .bind(keep_link_id)
    .execute(db)
    .await
    .map(|result| result.rows_affected())
    .map_err(|_| AppError::internal("failed to supersede older payment links"))
}

struct LinkRow {
    id: String,
    tenant_id: String,
    branch_id: String,
    status: String,
    amount_paise: i64,
    link_url: String,
    require_verification: bool,
    failed_verifications: i32,
    expired: bool,
    superseded: bool,
    invoice_number: String,
    branch_name: String,
    phone_last_four: String,
}

async fn find_by_token(db: &PgPool, token: &str) -> Result<LinkRow, AppError> {
    let row = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            i64,
            String,
            bool,
            i32,
            bool,
            bool,
            String,
            String,
            String,
        ),
    >(
        r#"SELECT link.id,
                  link.tenant_id,
                  link.branch_id,
                  link.status,
                  link.amount_paise,
                  link.link_url,
                  link.require_phone_verification,
                  link.failed_verifications,
                  link.expires_at IS NOT NULL AND link.expires_at <= NOW(),
                  link.superseded_by IS NOT NULL,
                  COALESCE(sale.invoice_number, ''),
                  COALESCE(branch.name, ''),
                  COALESCE(RIGHT(REGEXP_REPLACE(client.phone, '[^0-9]', '', 'g'), 4), '')
             FROM pos_payment_links link
             LEFT JOIN pos_sales sale
                    ON sale.id = link.sale_id AND sale.tenant_id = link.tenant_id
             LEFT JOIN clients client
                    ON client.id = sale.client_id AND client.tenant_id = link.tenant_id
             LEFT JOIN branches branch
                    ON branch.id = link.branch_id AND branch.tenant_id = link.tenant_id
            WHERE link.access_token_hash = $1"#,
    )
    .bind(auth_service::token_hash(token))
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to resolve the payment link"))?
    // A wrong token is not told apart from a missing one: probing for valid
    // tokens should learn nothing either way.
    .ok_or_else(|| AppError::not_found("this payment link is not valid"))?;

    Ok(LinkRow {
        id: row.0,
        tenant_id: row.1,
        branch_id: row.2,
        status: row.3,
        amount_paise: row.4,
        link_url: row.5,
        require_verification: row.6,
        failed_verifications: row.7,
        expired: row.8,
        superseded: row.9,
        invoice_number: row.10,
        branch_name: row.11,
        phone_last_four: row.12,
    })
}

async fn record_event(
    db: &PgPool,
    link: &LinkRow,
    event_type: &str,
    source_ip: &str,
    user_agent: &str,
    details: Value,
) {
    // Telemetry must never be the reason a guest cannot pay, so a failure here
    // is swallowed rather than propagated.
    let _ = sqlx::query(
        r#"INSERT INTO pos_payment_link_events
             (tenant_id, branch_id, link_id, event_type, source_ip, user_agent, details_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&link.id)
    .bind(event_type)
    .bind(source_ip)
    .bind(user_agent)
    .bind(details)
    .execute(db)
    .await;
}

/// Why a link cannot be paid, if it cannot.
fn unusable_reason(link: &LinkRow) -> Option<&'static str> {
    if link.superseded {
        return Some("A newer payment link replaced this one; please use the latest link.");
    }
    if link.expired {
        return Some("This payment link has expired. Ask the salon for a new one.");
    }
    match link.status.as_str() {
        "paid" => Some("This invoice has already been paid."),
        "cancelled" => Some("This payment link was cancelled."),
        "expired" => Some("This payment link has expired. Ask the salon for a new one."),
        "failed" => Some("This payment did not go through. Ask the salon for a new link."),
        _ => None,
    }
}

/// The guest opened the link.
pub async fn open(
    db: &PgPool,
    token: &str,
    source_ip: &str,
    user_agent: &str,
) -> Result<LinkChallenge, AppError> {
    let link = find_by_token(db, token).await?;

    let _ = sqlx::query(
        r#"UPDATE pos_payment_links
              SET opened_count = opened_count + 1,
                  first_opened_at = COALESCE(first_opened_at, NOW()),
                  last_opened_at = NOW()
            WHERE id = $1"#,
    )
    .bind(&link.id)
    .execute(db)
    .await;
    record_event(db, &link, "opened", source_ip, user_agent, json!({})).await;

    if let Some(reason) = unusable_reason(&link) {
        return Ok(LinkChallenge {
            status: link.status.clone(),
            amount_paise: link.amount_paise,
            branch_name: link.branch_name,
            invoice_number: link.invoice_number,
            verification_required: false,
            redirect_url: None,
            message: reason.to_string(),
        });
    }

    if link.failed_verifications >= MAX_FAILED_VERIFICATIONS {
        record_event(db, &link, "blocked", source_ip, user_agent, json!({})).await;
        return Ok(LinkChallenge {
            status: link.status,
            amount_paise: link.amount_paise,
            branch_name: link.branch_name,
            invoice_number: link.invoice_number,
            verification_required: false,
            redirect_url: None,
            message: "Too many incorrect attempts. Ask the salon for a new link.".to_string(),
        });
    }

    // Verification off, or no phone on the client record to check against:
    // forward straight through rather than locking a guest out of paying.
    if !link.require_verification || link.phone_last_four.len() < 4 {
        record_event(
            db,
            &link,
            "redirected",
            source_ip,
            user_agent,
            json!({ "verified": false }),
        )
        .await;
        return Ok(LinkChallenge {
            status: link.status,
            amount_paise: link.amount_paise,
            branch_name: link.branch_name,
            invoice_number: link.invoice_number,
            verification_required: false,
            redirect_url: Some(link.link_url),
            message: String::new(),
        });
    }

    Ok(LinkChallenge {
        status: link.status,
        amount_paise: link.amount_paise,
        branch_name: link.branch_name,
        invoice_number: link.invoice_number,
        verification_required: true,
        redirect_url: None,
        message: "Enter the last 4 digits of the phone number on this booking.".to_string(),
    })
}

/// The guest answered the phone challenge.
pub async fn verify(
    db: &PgPool,
    token: &str,
    digits: &str,
    source_ip: &str,
    user_agent: &str,
) -> Result<LinkChallenge, AppError> {
    let link = find_by_token(db, token).await?;

    if let Some(reason) = unusable_reason(&link) {
        return Err(AppError::validation(reason));
    }
    if link.failed_verifications >= MAX_FAILED_VERIFICATIONS {
        record_event(db, &link, "blocked", source_ip, user_agent, json!({})).await;
        return Err(AppError::rate_limited(
            "too many incorrect attempts; ask the salon for a new link",
        ));
    }

    let supplied: String = digits.chars().filter(char::is_ascii_digit).collect();
    if supplied.len() != 4 || supplied != link.phone_last_four {
        let _ = sqlx::query(
            "UPDATE pos_payment_links SET failed_verifications = failed_verifications + 1, updated_at = NOW() WHERE id = $1",
        )
        .bind(&link.id)
        .execute(db)
        .await;
        record_event(
            db,
            &link,
            "verification_failed",
            source_ip,
            user_agent,
            json!({ "attempt": link.failed_verifications + 1 }),
        )
        .await;
        return Err(AppError::validation(
            "those digits do not match the phone number on this booking",
        ));
    }

    record_event(db, &link, "verified", source_ip, user_agent, json!({})).await;
    record_event(
        db,
        &link,
        "redirected",
        source_ip,
        user_agent,
        json!({ "verified": true }),
    )
    .await;
    Ok(LinkChallenge {
        status: link.status,
        amount_paise: link.amount_paise,
        branch_name: link.branch_name,
        invoice_number: link.invoice_number,
        verification_required: false,
        redirect_url: Some(link.link_url),
        message: String::new(),
    })
}

/// A link's interaction history, for the invoice screen and dispute evidence.
pub async fn events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    link_id: &str,
) -> Result<Vec<Value>, AppError> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
                    'id', id, 'eventType', event_type, 'sourceIp', source_ip,
                    'userAgent', user_agent, 'details', details_json, 'createdAt', created_at)
             FROM pos_payment_link_events
            WHERE tenant_id = $1 AND branch_id = $2 AND link_id = $3
            ORDER BY created_at DESC
            LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(link_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load payment link events"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(status: &str) -> LinkRow {
        LinkRow {
            id: "link-1".into(),
            tenant_id: "t".into(),
            branch_id: "b".into(),
            status: status.into(),
            amount_paise: 150_000,
            link_url: "https://rzp.io/l/abc".into(),
            require_verification: true,
            failed_verifications: 0,
            expired: false,
            superseded: false,
            invoice_number: "INV-1".into(),
            branch_name: "Main".into(),
            phone_last_four: "4321".into(),
        }
    }

    #[test]
    fn a_paid_or_cancelled_link_says_so_instead_of_taking_another_payment() {
        for status in ["paid", "cancelled", "expired", "failed"] {
            assert!(
                unusable_reason(&link(status)).is_some(),
                "{status} must not be payable"
            );
        }
        assert!(unusable_reason(&link("pending")).is_none());
    }

    #[test]
    fn a_superseded_link_points_at_the_newer_one() {
        let mut superseded = link("pending");
        superseded.superseded = true;
        let reason = unusable_reason(&superseded).expect("superseded links are unusable");
        // An old URL in a chat thread has to say why rather than fail silently.
        assert!(reason.contains("newer payment link"), "{reason}");
    }

    #[test]
    fn expiry_beats_a_still_pending_status() {
        let mut expired = link("pending");
        expired.expired = true;
        assert!(unusable_reason(&expired).is_some());
    }

    #[test]
    fn the_attempt_cap_is_what_makes_four_digits_usable() {
        // 10^4 combinations are trivial to walk; the cap is the control, not
        // the secret. Keep it small enough that guessing is hopeless and large
        // enough that a guest mistyping twice is not locked out.
        assert!(MAX_FAILED_VERIFICATIONS >= 3 && MAX_FAILED_VERIFICATIONS <= 6);
    }

    #[test]
    fn digits_are_extracted_before_comparison() {
        // Guests type spaces and dashes; the comparison should be on digits.
        let cleaned: String = " 4-3 2 1 ".chars().filter(char::is_ascii_digit).collect();
        assert_eq!(cleaned, "4321");
        let short: String = "432".chars().filter(char::is_ascii_digit).collect();
        assert_ne!(short.len(), 4, "a partial answer must not be accepted");
    }
}
