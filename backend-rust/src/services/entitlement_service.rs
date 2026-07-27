use std::collections::BTreeSet;

use axum::http::Method;
use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    middleware::tenant::{normalize_route_path, route_access},
    models::common::AppError,
    repositories::saas_repository::{self, EntitlementContext},
    services::permission_registry,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchCreationDecision {
    Legacy,
    Included,
    BillableOverage { amount_paise: i64 },
}

/// Effective subscription lifecycle state, resolved from the stored status,
/// per-plan grace/retention policies, and any active audited override.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectiveState {
    /// Tenant predates subscriptions; full access for backward compatibility.
    Legacy,
    Trialing,
    Active,
    PastDue,
    /// Reads allowed, sensitive writes restricted.
    Grace,
    /// Operational read-only or fully blocked, per plan suspension policy.
    Suspended,
    /// Retention/export window after cancellation: read-only.
    Cancelled,
    /// Only login recovery and billing remain.
    Expired,
}

impl EffectiveState {
    pub const fn as_str(self) -> &'static str {
        match self {
            EffectiveState::Legacy => "legacy",
            EffectiveState::Trialing => "trialing",
            EffectiveState::Active => "active",
            EffectiveState::PastDue => "past_due",
            EffectiveState::Grace => "grace",
            EffectiveState::Suspended => "suspended",
            EffectiveState::Cancelled => "cancelled",
            EffectiveState::Expired => "expired",
        }
    }
}

pub fn effective_state(context: &EntitlementContext, now: DateTime<Utc>) -> EffectiveState {
    if let (Some(status), Some(expires_at)) =
        (context.override_status.as_deref(), context.override_expires_at)
    {
        if expires_at > now {
            return state_from_status(status, context, now);
        }
    }
    match context.subscription_status.as_deref() {
        None => EffectiveState::Legacy,
        Some(status) => state_from_status(status, context, now),
    }
}

fn state_from_status(
    status: &str,
    context: &EntitlementContext,
    now: DateTime<Utc>,
) -> EffectiveState {
    match status {
        "trialing" => EffectiveState::Trialing,
        "active" => EffectiveState::Active,
        "past_due" => {
            // Configurable grace period after the paid period lapses.
            let grace_days = i64::from(context.grace_period_days.unwrap_or(7));
            match context.current_period_end {
                Some(period_end) if now > period_end + Duration::days(grace_days) => {
                    EffectiveState::Grace
                }
                _ => EffectiveState::PastDue,
            }
        }
        "grace" => EffectiveState::Grace,
        "paused" | "suspended" => EffectiveState::Suspended,
        "cancelled" => {
            let retention_days = i64::from(context.retention_window_days.unwrap_or(30));
            let anchor = context.cancelled_at.or(context.current_period_end);
            match anchor {
                Some(ended_at) if now > ended_at + Duration::days(retention_days) => {
                    EffectiveState::Expired
                }
                _ => EffectiveState::Cancelled,
            }
        }
        "expired" => EffectiveState::Expired,
        _ => EffectiveState::Suspended,
    }
}

fn suspension_blocks_login(context: &EntitlementContext) -> bool {
    context
        .suspension_policy
        .as_deref()
        .is_some_and(|policy| policy == "blocked")
}

/// Plan feature grants. `None` means the plan declares no feature list and
/// legacy behavior applies (everything allowed).
fn plan_features(context: &EntitlementContext) -> Option<Vec<String>> {
    let features = context
        .plan_features
        .as_ref()?
        .as_array()?
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    if features.is_empty() {
        None
    } else {
        Some(features)
    }
}

/// Hierarchical feature match: a plan granting `staff` covers `staff.payroll`;
/// `all` covers everything.
fn feature_granted(granted: &[String], required: &str) -> bool {
    granted.iter().any(|feature| {
        feature == "all"
            || feature == required
            || required
                .strip_prefix(feature.as_str())
                .is_some_and(|rest| rest.starts_with('.'))
    })
}

/// Subscription features required by a route, derived from route metadata:
/// an explicit route feature override when present, otherwise the feature
/// keys of the permissions guarding the route (any-of semantics).
pub fn route_required_features(method: &Method, path: &str) -> (BTreeSet<&'static str>, bool) {
    let normalized = normalize_route_path(path);
    let Some(access) = route_access(normalized, method) else {
        return (BTreeSet::new(), false);
    };
    let sensitive = access
        .permission_keys()
        .iter()
        .any(|permission| permission_registry::is_sensitive(permission));
    if let Some(feature) = permission_registry::route_feature_override(normalized) {
        return (BTreeSet::from([feature]), sensitive);
    }
    let features = access
        .permission_keys()
        .iter()
        .filter_map(|permission| permission_registry::find(permission))
        .map(|spec| spec.feature_key)
        .collect();
    (features, sensitive)
}

fn feature_block_error(features: &BTreeSet<&'static str>, state: EffectiveState) -> AppError {
    AppError::forbidden("this feature is not included in the current subscription plan")
        .with_details(json!({
            "requiredFeatures": features.iter().collect::<Vec<_>>(),
            "subscriptionState": state.as_str(),
        }))
}

fn write_block_error(state: EffectiveState, message: &str) -> AppError {
    AppError::forbidden(message).with_details(json!({ "subscriptionState": state.as_str() }))
}

pub async fn ensure_can_login(db: &PgPool, tenant_id: &str) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    let context = load_context(db, tenant_id).await?;
    if context.tenant_status != "active" {
        return Err(AppError::forbidden("salon access is suspended"));
    }
    let state = effective_state(&context, Utc::now());
    match state {
        EffectiveState::Expired => Err(write_block_error(
            state,
            "subscription has expired; only account recovery and billing remain available",
        )),
        EffectiveState::Suspended if suspension_blocks_login(&context) => Err(write_block_error(
            state,
            "subscription is suspended and access is blocked",
        )),
        _ => Ok(()),
    }
}

/// Central entitlement gate for mutating requests, called from the auth
/// middleware. Feature requirements come from route metadata (the permission
/// registry), never from URL regexes.
pub async fn ensure_route_write_allowed(
    db: &PgPool,
    tenant_id: &str,
    method: &Method,
    path: &str,
) -> Result<(), AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Ok(());
    }
    let context = load_context(db, tenant_id).await?;
    if context.tenant_status != "active" {
        return Err(AppError::forbidden("salon access is suspended"));
    }
    let state = effective_state(&context, Utc::now());
    let (required_features, sensitive) = route_required_features(method, path);

    match state {
        EffectiveState::Legacy | EffectiveState::Trialing | EffectiveState::Active
        | EffectiveState::PastDue => {}
        EffectiveState::Grace => {
            if sensitive {
                return Err(write_block_error(
                    state,
                    "sensitive changes are restricted while the subscription is in its grace period",
                ));
            }
        }
        EffectiveState::Suspended => {
            return Err(write_block_error(
                state,
                "subscription is suspended; the account is read-only",
            ));
        }
        EffectiveState::Cancelled => {
            return Err(write_block_error(
                state,
                "subscription is cancelled; data remains available read-only during the retention window",
            ));
        }
        EffectiveState::Expired => {
            return Err(write_block_error(
                state,
                "subscription has expired; only account recovery and billing remain available",
            ));
        }
    }

    if let Some(granted) = plan_features(&context) {
        if !required_features.is_empty()
            && !required_features
                .iter()
                .any(|required| feature_granted(&granted, required))
        {
            return Err(feature_block_error(&required_features, state));
        }
    }
    Ok(())
}

/// Owner-facing entitlement summary for API responses.
pub async fn entitlement_summary(
    db: &PgPool,
    tenant_id: &str,
) -> Result<serde_json::Value, AppError> {
    let context = load_context(db, tenant_id).await?;
    let state = effective_state(&context, Utc::now());
    let features = plan_features(&context);
    Ok(json!({
        "subscriptionStatus": context.subscription_status,
        "effectiveState": state.as_str(),
        "features": features,
        "allFeatures": features.is_none(),
        "gracePeriodDays": context.grace_period_days,
        "suspensionPolicy": context.suspension_policy,
        "retentionWindowDays": context.retention_window_days,
        "currentPeriodEnd": context.current_period_end,
        "trialEndsAt": context.trial_ends_at,
        "cancelledAt": context.cancelled_at,
        "overrideActive": context.override_status.is_some(),
        "readOnly": matches!(
            state,
            EffectiveState::Suspended | EffectiveState::Cancelled | EffectiveState::Expired
        ),
        "sensitiveWritesRestricted": matches!(state, EffectiveState::Grace),
    }))
}

async fn load_context(db: &PgPool, tenant_id: &str) -> Result<EntitlementContext, AppError> {
    saas_repository::entitlement_context(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate salon entitlement"))?
        .ok_or_else(|| AppError::unauthenticated("salon is not active"))
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
    use axum::http::Method;
    use chrono::{Duration, Utc};

    use super::{
        branch_creation_decision, effective_state, feature_granted, route_required_features,
        BranchCreationDecision, EffectiveState, EntitlementContext,
    };

    fn context(status: Option<&str>) -> EntitlementContext {
        EntitlementContext {
            tenant_status: "active".into(),
            subscription_status: status.map(str::to_string),
            included_branches: Some(1),
            overage_branch_paise: Some(0),
            active_branch_count: 1,
            plan_features: None,
            grace_period_days: Some(7),
            suspension_policy: Some("read_only".into()),
            retention_window_days: Some(30),
            current_period_end: Some(Utc::now() + Duration::days(10)),
            trial_ends_at: None,
            cancelled_at: None,
            override_status: None,
            override_expires_at: None,
        }
    }

    #[test]
    fn lifecycle_states_follow_policy_windows() {
        let now = Utc::now();
        assert_eq!(effective_state(&context(None), now), EffectiveState::Legacy);
        assert_eq!(
            effective_state(&context(Some("trialing")), now),
            EffectiveState::Trialing
        );
        assert_eq!(
            effective_state(&context(Some("active")), now),
            EffectiveState::Active
        );

        // past_due inside the configured grace window keeps working; beyond
        // it the tenant drops to grace restrictions.
        let mut past_due = context(Some("past_due"));
        past_due.current_period_end = Some(now - Duration::days(3));
        assert_eq!(effective_state(&past_due, now), EffectiveState::PastDue);
        past_due.current_period_end = Some(now - Duration::days(8));
        assert_eq!(effective_state(&past_due, now), EffectiveState::Grace);

        assert_eq!(
            effective_state(&context(Some("paused")), now),
            EffectiveState::Suspended
        );
        assert_eq!(
            effective_state(&context(Some("suspended")), now),
            EffectiveState::Suspended
        );

        // Cancelled keeps a retention/export window, then expires.
        let mut cancelled = context(Some("cancelled"));
        cancelled.cancelled_at = Some(now - Duration::days(5));
        assert_eq!(effective_state(&cancelled, now), EffectiveState::Cancelled);
        cancelled.cancelled_at = Some(now - Duration::days(45));
        assert_eq!(effective_state(&cancelled, now), EffectiveState::Expired);

        assert_eq!(
            effective_state(&context(Some("expired")), now),
            EffectiveState::Expired
        );
    }

    #[test]
    fn audited_override_wins_until_it_expires() {
        let now = Utc::now();
        let mut suspended = context(Some("suspended"));
        suspended.override_status = Some("active".into());
        suspended.override_expires_at = Some(now + Duration::days(2));
        assert_eq!(effective_state(&suspended, now), EffectiveState::Active);
        suspended.override_expires_at = Some(now - Duration::hours(1));
        assert_eq!(effective_state(&suspended, now), EffectiveState::Suspended);
    }

    #[test]
    fn feature_matching_is_hierarchical_not_url_based() {
        let granted = vec!["staff".to_string(), "reports.export".to_string()];
        assert!(feature_granted(&granted, "staff.payroll"));
        assert!(feature_granted(&granted, "staff.basic"));
        assert!(feature_granted(&granted, "reports.export"));
        assert!(!feature_granted(&granted, "marketing"));
        assert!(!feature_granted(&granted, "staffing"));
        assert!(feature_granted(&["all".to_string()], "anything.at.all"));
    }

    #[test]
    fn route_metadata_maps_features_and_sensitivity() {
        let (features, sensitive) =
            route_required_features(&Method::POST, "/api/v1/staff-payroll/runs");
        assert!(features.contains("staff.payroll"));
        assert!(sensitive);

        let (features, sensitive) = route_required_features(&Method::POST, "/api/v1/appointments");
        assert!(features.contains("appointments"));
        assert!(!sensitive);

        let (features, _) =
            route_required_features(&Method::POST, "/api/v1/staff/biometric/devices");
        assert_eq!(features.iter().copied().collect::<Vec<_>>(), ["staff.biometric"]);

        let (features, _) = route_required_features(
            &Method::POST,
            "/api/v1/settings/integrations/api-keys/key-1/rotate",
        );
        assert_eq!(features.iter().copied().collect::<Vec<_>>(), ["staff.api"]);
    }

    #[test]
    fn branch_limit_blocks_or_bills_from_plan_price() {
        let mut context = context(Some("active"));
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
