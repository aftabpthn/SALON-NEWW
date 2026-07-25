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
    ensure_access(db, tenant_id).await
}

pub async fn ensure_can_write(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    ensure_access(db, tenant_id).await
}

async fn ensure_access(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    let context = saas_repository::entitlement_context(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate salon entitlement"))?
        .ok_or_else(|| AppError::unauthenticated("salon is not active"))?;
    if context.tenant_status != "active" {
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
    if context.tenant_status != "active" {
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
            tenant_status: "active".into(),
            subscription_status: Some("active".into()),
            included_branches: Some(1),
            overage_branch_paise: Some(0),
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
        context.tenant_status = "suspended".into();
        assert!(branch_creation_decision(&context, 1).is_err());
        context.tenant_status = "active".into();
        context.subscription_status = Some("cancelled".into());
        assert!(branch_creation_decision(&context, 1).is_err());
    }
}
