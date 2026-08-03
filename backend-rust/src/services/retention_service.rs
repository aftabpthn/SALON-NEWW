use chrono::NaiveDate;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError, repositories::retention_repository, services::membership_service,
};

pub async fn client_snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Value, AppError> {
    let cards = retention_repository::list_gift_cards(
        db,
        tenant_id,
        branch_id,
        Some(client_id),
        None,
        None,
    )
    .await
    .map_err(|_| AppError::internal("failed to load gift cards"))?;
    let points = retention_repository::reward_balance(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load loyalty balance"))?;
    let ledger = retention_repository::reward_ledger(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load loyalty ledger"))?;
    let code = retention_repository::referral_code(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load referral code"))?;
    let referrals = retention_repository::list_referrals(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load referrals"))?;
    let referred_by = retention_repository::referred_by(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load referral source"))?;
    let settings = membership_service::membership_settings(db, tenant_id, branch_id).await?;
    Ok(
        json!({"giftCards":cards,"loyalty":tier_snapshot(&settings,points),"rewardLedger":ledger,"referralCode":code,"referrals":referrals,"referredBy":referred_by}),
    )
}

pub async fn gift_cards(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
    status: Option<&str>,
    code: Option<&str>,
) -> Result<Vec<retention_repository::GiftCardListRecord>, AppError> {
    if status.is_some_and(|value| {
        !matches!(
            value,
            "active" | "redeemed" | "expired" | "voided" | "blocked"
        )
    }) {
        return Err(AppError::validation("invalid gift card status"));
    }
    let code = code.map(str::trim).filter(|value| !value.is_empty());
    if code.is_some_and(|value| value.len() > 64) {
        return Err(AppError::validation(
            "gift card code must be 64 characters or fewer",
        ));
    }
    retention_repository::list_gift_cards(db, tenant_id, branch_id, client_id, status, code)
        .await
        .map_err(|_| AppError::internal("failed to load gift cards"))
}

pub async fn gift_card_detail(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Value, AppError> {
    let card = retention_repository::gift_card(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load gift card"))?
        .ok_or_else(|| AppError::not_found("gift card not found"))?;
    let transactions = retention_repository::gift_card_transactions(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load gift card history"))?;
    Ok(json!({"card":card,"transactions":transactions}))
}

pub async fn void_gift_card(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    reason: &str,
    key: &str,
    actor: &str,
) -> Result<retention_repository::GiftCardRecord, AppError> {
    let reason = required(reason, "reason is required")?;
    let key = idempotency_key(key)?;
    retention_repository::void_gift_card(db, tenant_id, branch_id, id, reason, key, actor)
        .await
        .map_err(|_| AppError::internal("failed to void gift card"))?
        .ok_or_else(|| AppError::conflict("gift card must be active with a positive balance"))
}

#[allow(clippy::too_many_arguments)]
pub async fn reissue_gift_card(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    code: Option<&str>,
    expires_at: Option<NaiveDate>,
    reason: &str,
    key: &str,
    actor: &str,
) -> Result<retention_repository::GiftCardRecord, AppError> {
    let reason = required(reason, "reason is required")?;
    let key = idempotency_key(key)?;
    let code = code
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_uppercase)
        .unwrap_or_else(|| {
            format!("GC-{}", &uuid::Uuid::new_v4().to_string()[..8]).to_ascii_uppercase()
        });
    if code.len() > 64 {
        return Err(AppError::validation("code must be 64 characters or fewer"));
    }
    retention_repository::reissue_gift_card(
        db, tenant_id, branch_id, id, &code, expires_at, reason, key, actor,
    )
    .await
    .map_err(|error| {
        if is_unique_violation(&error) {
            AppError::conflict("gift card code or idempotencyKey already exists")
        } else {
            AppError::internal("failed to reissue gift card")
        }
    })?
    .ok_or_else(|| AppError::conflict("gift card must be active with a positive balance"))
}

#[allow(clippy::too_many_arguments)]
pub async fn transfer_gift_card(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    target_client_id: &str,
    reason: &str,
    key: &str,
    actor: &str,
) -> Result<retention_repository::GiftCardRecord, AppError> {
    let target = required(target_client_id, "targetClientId is required")?;
    let reason = required(reason, "reason is required")?;
    let key = idempotency_key(key)?;
    retention_repository::transfer_gift_card(
        db, tenant_id, branch_id, id, target, reason, key, actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to transfer gift card"))?
    .ok_or_else(|| AppError::conflict("gift card or transfer target is not available"))
}

pub async fn ensure_referral_code(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    actor: &str,
) -> Result<retention_repository::ReferralCodeRecord, AppError> {
    if let Some(existing) = retention_repository::referral_code(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load referral code"))?
    {
        return Ok(existing);
    }
    let code = format!("REF-{}", &uuid::Uuid::new_v4().to_string()[..8]).to_ascii_uppercase();
    retention_repository::ensure_referral_code(db, tenant_id, branch_id, client_id, &code, actor)
        .await
        .map_err(|_| AppError::internal("failed to create referral code"))?
        .ok_or_else(|| AppError::not_found("client not found"))
}

pub async fn create_referral(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    referrer_id: &str,
    referred_id: &str,
    key: &str,
    actor: &str,
) -> Result<retention_repository::ReferralRecord, AppError> {
    if referrer_id == referred_id {
        return Err(AppError::validation(
            "referrer and referred client must be different",
        ));
    }
    let key = idempotency_key(key)?;
    let code = ensure_referral_code(db, tenant_id, branch_id, referrer_id, actor).await?;
    retention_repository::create_referral(
        db,
        tenant_id,
        branch_id,
        referrer_id,
        referred_id,
        &code.id,
        key,
        actor,
    )
    .await
    .map_err(|error| {
        if is_unique_violation(&error) {
            AppError::conflict("referred client already has a referral")
        } else {
            AppError::internal("failed to create referral")
        }
    })?
    .ok_or_else(|| AppError::not_found("referred client not found"))
}

pub async fn complete_referral(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<retention_repository::ReferralRecord, AppError> {
    let qualified = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM pos_sales sale WHERE sale.tenant_id=r.tenant_id AND sale.branch_id=r.branch_id AND sale.client_id=r.referred_client_id AND sale.status='paid' AND sale.total_paise>0 AND sale.created_at>=r.created_at) FROM client_referrals r WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3",
    )
    .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
    .map_err(|_| AppError::internal("failed to validate referral purchase"))?
    .ok_or_else(|| AppError::not_found("referral not found"))?;
    if !qualified {
        return Err(AppError::conflict(
            "referral reward requires a paid qualifying purchase",
        ));
    }
    let settings = membership_service::membership_settings(db, tenant_id, branch_id).await?;
    let referral = settings.get("referrals").cloned().unwrap_or_default();
    if referral.get("enabled").and_then(Value::as_bool) == Some(false) {
        return Err(AppError::conflict("referral rewards are disabled"));
    }
    let referrer_points = points_setting(&referral, "referrerRewardPoints")?;
    let referred_points = points_setting(&referral, "referredRewardPoints")?;
    retention_repository::complete_referral(
        db,
        tenant_id,
        branch_id,
        id,
        referrer_points,
        referred_points,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to complete referral"))?
    .ok_or_else(|| AppError::not_found("referral not found"))
}

pub fn tier_snapshot(settings: &Value, points: i32) -> Value {
    let enabled = settings
        .pointer("/loyaltyTiers/enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut tiers = settings
        .pointer("/loyaltyTiers/tiers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    tiers.sort_by_key(|tier| {
        tier.get("minimumPoints")
            .and_then(Value::as_i64)
            .unwrap_or(0)
    });
    let current = enabled
        .then(|| {
            tiers
                .iter()
                .rev()
                .find(|tier| {
                    tier.get("minimumPoints")
                        .and_then(Value::as_i64)
                        .unwrap_or(0)
                        <= i64::from(points)
                })
                .cloned()
        })
        .flatten();
    let next = enabled
        .then(|| {
            tiers
                .iter()
                .find(|tier| {
                    tier.get("minimumPoints")
                        .and_then(Value::as_i64)
                        .unwrap_or(0)
                        > i64::from(points)
                })
                .cloned()
        })
        .flatten();
    let points_to_next = next
        .as_ref()
        .and_then(|tier| tier.get("minimumPoints"))
        .and_then(Value::as_i64)
        .map(|minimum| (minimum - i64::from(points)).max(0));
    json!({"pointsBalance":points,"currentTier":current,"nextTier":next,"pointsToNextTier":points_to_next,"enabled":enabled})
}

fn required<'a>(value: &'a str, message: &'static str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() {
        Err(AppError::validation(message))
    } else {
        Ok(value)
    }
}
fn idempotency_key(value: &str) -> Result<&str, AppError> {
    let value = required(value, "idempotencyKey is required")?;
    if !(8..=120).contains(&value.len())
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
    {
        return Err(AppError::validation(
            "idempotencyKey must be 8-120 letters, numbers, hyphens, underscores, or colons",
        ));
    }
    Ok(value)
}
fn points_setting(settings: &Value, key: &str) -> Result<i32, AppError> {
    settings
        .get(key)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| *value >= 0)
        .ok_or_else(|| AppError::validation(format!("invalid {key}")))
}
fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|value| value.is_unique_violation())
}

#[cfg(test)]
mod tests {
    use super::tier_snapshot;
    use serde_json::json;

    #[test]
    fn loyalty_tier_selects_current_and_next_threshold() {
        let settings = json!({"loyaltyTiers":{"enabled":true,"tiers":[{"code":"bronze","name":"Bronze","minimumPoints":0},{"code":"silver","name":"Silver","minimumPoints":1000},{"code":"gold","name":"Gold","minimumPoints":5000}]}});
        let snapshot = tier_snapshot(&settings, 1250);
        assert_eq!(snapshot["currentTier"]["code"], "silver");
        assert_eq!(snapshot["nextTier"]["code"], "gold");
        assert_eq!(snapshot["pointsToNextTier"], 3750);
    }
}
