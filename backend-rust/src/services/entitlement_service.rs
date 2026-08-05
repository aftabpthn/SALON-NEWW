use chrono::Utc;
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    models::common::AppError,
    repositories::saas_repository::{self, EntitlementContext},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchCreationDecision {
    Legacy,
    Included,
    BillableOverage { amount_paise: i64 },
}

pub async fn ensure_can_login(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    ensure_login_context(&load_context(db, tenant_id).await?)
}

pub async fn ensure_can_write(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    ensure_write_context(&load_context(db, tenant_id).await?)
}

/// Whether the salon is barred outright, ignoring what it owes.
///
/// Lapsing gates the product, not the record. A salon behind on payment still
/// has to be able to sign in, see what it owes, pay it, and — if it is leaving
/// — take its own client book, invoices and payroll records with it. Refusing
/// all of that is not a paywall, it is holding the data hostage, and it is the
/// kind of thing salons tell other salons about.
///
/// Platform suspension is a different decision and still applies:
/// `tenant_access_allowed` covers abuse and fraud holds, which are not softened
/// by having paid.
async fn ensure_not_suspended(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    if !load_context(db, tenant_id).await?.tenant_access_allowed {
        return Err(AppError::forbidden("salon access is suspended"));
    }
    Ok(())
}

/// Whether a login may be issued at all.
///
/// Deliberately weaker than [`ensure_can_login`], which decides whether a
/// request may reach the product. A lapsed salon is let through the door and
/// stopped at the paywall inside, because the alternative locks the owner out
/// of the one screen where they could pay — the previous behaviour, which left
/// renewal reachable only by contacting the platform.
pub async fn ensure_can_authenticate(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    ensure_not_suspended(db, tenant_id).await
}

/// Whether a salon may take its own data out, whatever its subscription says.
pub async fn ensure_can_export(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    ensure_not_suspended(db, tenant_id).await
}

pub async fn ensure_feature(
    db: &PgPool,
    tenant_id: &str,
    feature_key: &str,
) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    ensure_feature_context(&load_context(db, tenant_id).await?, feature_key, false)
}

pub async fn ensure_write_feature(
    db: &PgPool,
    tenant_id: &str,
    feature_key: &str,
) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    ensure_feature_context(&load_context(db, tenant_id).await?, feature_key, true)
}

async fn load_context(db: &PgPool, tenant_id: &str) -> Result<EntitlementContext, AppError> {
    saas_repository::entitlement_context(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate salon entitlement"))?
        .ok_or_else(|| AppError::unauthenticated("salon is not active"))
}

fn ensure_login_context(context: &EntitlementContext) -> Result<(), AppError> {
    if !context.tenant_access_allowed {
        return Err(AppError::forbidden("salon access is suspended"));
    }
    match context.subscription_status.as_deref() {
        None | Some("trialing" | "active" | "past_due") => Ok(()),
        Some(status) => Err(
            AppError::forbidden("subscription does not allow salon access")
                .with_details(json!({"subscriptionStatus": status})),
        ),
    }
}

fn ensure_write_context(context: &EntitlementContext) -> Result<(), AppError> {
    ensure_login_context(context)?;
    if context.subscription_status.as_deref() != Some("past_due") {
        return Ok(());
    }
    // Falling behind does not stop the salon working; staying behind does. The
    // window comes from the plan and is measured by the database clock, so a
    // client with a wrong system time cannot extend or shorten it.
    //
    // A missing end date means the stamp did not survive whatever wrote the
    // status. Treating that as "grace forever" would let a delinquent salon
    // keep writing indefinitely, so it closes the window instead.
    let grace_active = context
        .past_due_grace_ends_at
        .is_some_and(|ends_at| Utc::now() < ends_at);
    if grace_active {
        return Ok(());
    }
    Err(
        AppError::forbidden("past-due subscription is read-only").with_details(
            json!({"subscriptionStatus": "past_due", "readOnly": true, "graceEnded": true}),
        ),
    )
}

fn ensure_feature_context(
    context: &EntitlementContext,
    feature_key: &str,
    write: bool,
) -> Result<(), AppError> {
    if write {
        ensure_write_context(context)?;
    } else {
        ensure_login_context(context)?;
    }
    if let Some(enabled) = context
        .feature_overrides_json
        .get(feature_key)
        .and_then(serde_json::Value::as_bool)
    {
        return if enabled {
            Ok(())
        } else {
            Err(
                AppError::forbidden("tenant feature override disables this capability")
                    .with_details(json!({"featureKey": feature_key, "override": false})),
            )
        };
    }
    if context.subscription_status.is_none() {
        return Ok(());
    }
    let enabled = context
        .features_json
        .as_ref()
        .and_then(serde_json::Value::as_array)
        .is_some_and(|features| {
            features
                .iter()
                .filter_map(serde_json::Value::as_str)
                .any(|feature| feature.eq_ignore_ascii_case(feature_key))
        });
    if enabled {
        Ok(())
    } else {
        Err(
            AppError::forbidden("subscription plan does not include this feature")
                .with_details(json!({"featureKey": feature_key})),
        )
    }
}

pub async fn ensure_can_create_branch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
) -> Result<BranchCreationDecision, AppError> {
    ensure_can_create_branches_tx(tx, tenant_id, 1).await
}

pub async fn ensure_can_create_branches(
    db: &PgPool,
    tenant_id: &str,
    additional_branches: i64,
) -> Result<BranchCreationDecision, AppError> {
    let context = saas_repository::entitlement_context(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate branch entitlement"))?
        .ok_or_else(|| AppError::not_found("tenant was not found"))?;
    branch_creation_decision(&context, additional_branches)
}

pub async fn ensure_can_create_branches_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    additional_branches: i64,
) -> Result<BranchCreationDecision, AppError> {
    let context = saas_repository::entitlement_context_tx(tx, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate branch entitlement"))?
        .ok_or_else(|| AppError::not_found("tenant was not found"))?;
    branch_creation_decision(&context, additional_branches)
}

fn branch_creation_decision(
    context: &EntitlementContext,
    additional_branches: i64,
) -> Result<BranchCreationDecision, AppError> {
    if !context.tenant_access_allowed {
        return Err(AppError::forbidden("salon access is suspended"));
    }
    let Some(status) = context.subscription_status.as_deref() else {
        return Ok(BranchCreationDecision::Legacy);
    };
    if status == "past_due" {
        return Err(AppError::conflict(
            "past-due subscription cannot add another branch",
        ));
    }
    if !matches!(status, "trialing" | "active") {
        return Err(
            AppError::forbidden("subscription does not allow another branch")
                .with_details(json!({"subscriptionStatus": status})),
        );
    }

    let included = i64::from(context.included_branches.unwrap_or(0));
    let overage = context.overage_branch_paise.unwrap_or(0);
    let requested_total = context
        .active_branch_count
        .saturating_add(additional_branches.max(0));
    if requested_total <= included {
        return Ok(BranchCreationDecision::Included);
    }
    if overage > 0 {
        return Ok(BranchCreationDecision::BillableOverage {
            amount_paise: overage,
        });
    }
    Err(
        AppError::conflict("branch limit reached; upgrade the plan or enable paid branch overage")
            .with_details(json!({
                "subscriptionStatus": status,
                "activeBranches": context.active_branch_count,
                "requestedBranches": additional_branches,
                "requestedTotalBranches": requested_total,
                "includedBranches": included,
                "overageBranchPaise": overage,
                "decision": "blocked"
            })),
    )
}

#[cfg(test)]
mod tests {
    use super::{branch_creation_decision, BranchCreationDecision, EntitlementContext};

    #[test]
    fn branch_limit_blocks_or_bills_from_plan_price() {
        let mut context = EntitlementContext {
            tenant_access_allowed: true,
            subscription_status: Some("active".into()),
            features_json: Some(serde_json::json!(["staff.basic"])),
            feature_overrides_json: serde_json::json!({}),
            included_branches: Some(1),
            overage_branch_paise: Some(0),
            past_due_grace_ends_at: None,
            active_branch_count: 1,
        };
        assert!(branch_creation_decision(&context, 1).is_err());
        context.overage_branch_paise = Some(50_000);
        assert_eq!(
            branch_creation_decision(&context, 100).unwrap(),
            BranchCreationDecision::BillableOverage {
                amount_paise: 50_000
            }
        );
        context.subscription_status = Some("past_due".into());
        assert!(branch_creation_decision(&context, 1).is_err());
        context.subscription_status = Some("active".into());
        context.tenant_access_allowed = false;
        assert!(branch_creation_decision(&context, 1).is_err());
        context.tenant_access_allowed = true;
        context.subscription_status = Some("cancelled".into());
        assert!(branch_creation_decision(&context, 1).is_err());
    }

    #[test]
    fn staff_security_login_write_and_feature_policies_are_distinct() {
        let mut context = EntitlementContext {
            tenant_access_allowed: true,
            subscription_status: Some("past_due".into()),
            features_json: Some(serde_json::json!(["staff.basic"])),
            feature_overrides_json: serde_json::json!({}),
            included_branches: Some(1),
            overage_branch_paise: Some(0),
            past_due_grace_ends_at: None,
            active_branch_count: 1,
        };
        assert!(super::ensure_login_context(&context).is_ok());
        assert!(super::ensure_write_context(&context).is_err());
        assert!(super::ensure_feature_context(&context, "staff.basic", false).is_ok());
        assert!(super::ensure_feature_context(&context, "staff.payroll", false).is_err());

        context.feature_overrides_json = serde_json::json!({"staff.payroll": true});
        assert!(super::ensure_feature_context(&context, "staff.payroll", false).is_ok());
        context.feature_overrides_json = serde_json::json!({"staff.basic": false});
        assert!(super::ensure_feature_context(&context, "staff.basic", false).is_err());

        context.subscription_status = None;
        context.features_json = None;
        context.feature_overrides_json = serde_json::json!({});
        assert!(super::ensure_feature_context(&context, "staff.payroll", true).is_ok());
    }

    fn past_due_context(
        grace_ends_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> EntitlementContext {
        EntitlementContext {
            tenant_access_allowed: true,
            subscription_status: Some("past_due".into()),
            features_json: Some(serde_json::json!(["staff.basic"])),
            feature_overrides_json: serde_json::json!({}),
            included_branches: Some(1),
            overage_branch_paise: Some(0),
            past_due_grace_ends_at: grace_ends_at,
            active_branch_count: 1,
        }
    }

    #[test]
    fn a_salon_keeps_working_while_the_grace_window_is_open() {
        // The case this exists for: a card expires on Friday and the salon
        // still bills walk-ins on Saturday.
        let context = past_due_context(Some(chrono::Utc::now() + chrono::Duration::days(6)));
        assert!(super::ensure_login_context(&context).is_ok());
        assert!(super::ensure_write_context(&context).is_ok());
        assert!(super::ensure_feature_context(&context, "staff.basic", true).is_ok());
    }

    #[test]
    fn writes_stop_once_the_grace_window_closes() {
        let context = past_due_context(Some(chrono::Utc::now() - chrono::Duration::minutes(1)));
        // Reading never stopped, and does not stop now.
        assert!(super::ensure_login_context(&context).is_ok());
        let error = super::ensure_write_context(&context).expect_err("writes must be refused");
        // The banner branches on these, so the shape is part of the contract.
        let details = error.details().cloned().unwrap_or_default();
        assert_eq!(details["subscriptionStatus"], serde_json::json!("past_due"));
        assert_eq!(details["readOnly"], serde_json::json!(true));
        assert_eq!(details["graceEnded"], serde_json::json!(true));
    }

    #[test]
    fn a_missing_grace_stamp_closes_the_window_rather_than_opening_it() {
        // The stamp is trigger-maintained, so its absence means something went
        // wrong upstream. Failing open here would let a delinquent salon write
        // forever, which is the more expensive of the two mistakes.
        assert!(super::ensure_write_context(&past_due_context(None)).is_err());
    }

    #[test]
    fn the_grace_window_only_applies_to_past_due() {
        // An open window must not rescue a status that was never about payment
        // timing. A cancelled salon stays out whatever the column says.
        let mut context = past_due_context(Some(chrono::Utc::now() + chrono::Duration::days(6)));
        context.subscription_status = Some("cancelled".into());
        assert!(super::ensure_write_context(&context).is_err());
        context.subscription_status = Some("paused".into());
        assert!(super::ensure_write_context(&context).is_err());
        // And suspension is not a payment decision at all.
        context.subscription_status = Some("past_due".into());
        context.tenant_access_allowed = false;
        assert!(super::ensure_write_context(&context).is_err());
    }
}
