use serde_json::json;
use sqlx::PgPool;

use crate::{
    models::{
        common::AppError,
        profit_governance::{
            ActionEvaluationRequest, DiscountEvaluationRequest, GovernanceApproval,
            GovernanceAuditEvent, GovernanceEvaluationResponse, GovernanceListQuery,
            GovernanceRule, GovernanceRuleSaveRequest, GovernanceSummary, ProfitAction,
            ProfitActionCreateRequest,
        },
    },
    repositories::profit_governance_repository::{
        self, ActionTransitionOutcome, NewGovernanceDecision, ReviewOutcome,
    },
};

const SENSITIVE_ACTIONS: &[&str] = &[
    "pricing_recommendation",
    "discount_abuse",
    "high_wastage",
    "membership_liability_risk",
    "low_margin_service",
    "high_expense",
];

struct PolicyOutcome {
    rule_id: Option<String>,
    decision: &'static str,
    status: &'static str,
    reasons: Vec<&'static str>,
    message: &'static str,
}

pub async fn list_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<GovernanceRule>, AppError> {
    profit_governance_repository::list_rules(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load profit governance rules"))
}

pub async fn save_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    mut payload: GovernanceRuleSaveRequest,
) -> Result<GovernanceRule, AppError> {
    payload.rule_type = payload.rule_type.trim().to_ascii_lowercase();
    payload.severity = payload.severity.trim().to_ascii_lowercase();
    validate_rule(&payload)?;
    profit_governance_repository::save_rule(db, tenant_id, branch_id, actor_user_id, &payload)
        .await
        .map_err(|_| AppError::internal("failed to save profit governance rule"))
}

pub async fn evaluate_discount(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    payload: DiscountEvaluationRequest,
) -> Result<GovernanceEvaluationResponse, AppError> {
    validate_identity(
        &payload.idempotency_key,
        &payload.source_type,
        &payload.source_id,
    )?;
    let membership_redemption_paise = payload.membership_redemption_paise.unwrap_or(0);
    if payload.gross_amount_paise <= 0 {
        return Err(AppError::validation(
            "grossAmountPaise must be greater than zero",
        ));
    }
    if [
        payload.discount_paise,
        payload.product_cost_paise,
        payload.staff_cost_paise,
        membership_redemption_paise,
    ]
    .iter()
    .any(|value| *value < 0)
    {
        return Err(AppError::validation(
            "profit evaluation amounts cannot be negative",
        ));
    }
    if payload.discount_paise > payload.gross_amount_paise {
        return Err(AppError::validation(
            "discountPaise cannot exceed grossAmountPaise",
        ));
    }

    let net_paise = payload
        .gross_amount_paise
        .saturating_sub(payload.discount_paise);
    let estimated_profit_paise = net_paise
        .saturating_sub(payload.product_cost_paise)
        .saturating_sub(payload.staff_cost_paise)
        .saturating_sub(membership_redemption_paise);
    let margin_bps = estimated_profit_paise.saturating_mul(10_000) / payload.gross_amount_paise;
    let discount_bps = payload.discount_paise.saturating_mul(10_000) / payload.gross_amount_paise;
    let rules = list_rules(db, tenant_id, branch_id).await?;
    let outcome = discount_policy(
        &rules,
        estimated_profit_paise,
        margin_bps,
        discount_bps,
        payload.discount_paise,
    );
    let reasons = json!(outcome.reasons);
    let recorded = profit_governance_repository::record_evaluation(
        db,
        tenant_id,
        branch_id,
        NewGovernanceDecision {
            rule_id: outcome.rule_id.as_deref(),
            decision_type: "discount",
            source_type: payload.source_type.trim(),
            source_id: payload.source_id.trim(),
            action_type: "",
            decision: outcome.decision,
            status: outcome.status,
            gross_amount_paise: payload.gross_amount_paise,
            discount_paise: payload.discount_paise,
            product_cost_paise: payload.product_cost_paise,
            staff_cost_paise: payload.staff_cost_paise,
            membership_redemption_paise,
            estimated_profit_paise,
            margin_bps,
            discount_bps,
            impact_paise: payload.discount_paise,
            reason_codes: reasons,
            message: outcome.message,
            requested_by_user_id: actor_user_id,
            idempotency_key: payload.idempotency_key.trim(),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to record profit governance decision"))?;
    if recorded.replayed
        && (recorded.decision.decision_type != "discount"
            || recorded.decision.source_type != payload.source_type.trim()
            || recorded.decision.source_id != payload.source_id.trim()
            || recorded.decision.gross_amount_paise != payload.gross_amount_paise
            || recorded.decision.discount_paise != payload.discount_paise
            || recorded.decision.product_cost_paise != payload.product_cost_paise
            || recorded.decision.staff_cost_paise != payload.staff_cost_paise
            || recorded.decision.membership_redemption_paise != membership_redemption_paise)
    {
        return Err(AppError::conflict(
            "idempotencyKey was already used for a different profit decision",
        ));
    }
    Ok(GovernanceEvaluationResponse {
        decision: recorded.decision,
        approval: recorded.approval,
        replayed: recorded.replayed,
    })
}

pub async fn evaluate_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    mut payload: ActionEvaluationRequest,
) -> Result<GovernanceEvaluationResponse, AppError> {
    validate_identity(
        &payload.idempotency_key,
        &payload.source_type,
        &payload.source_id,
    )?;
    payload.action_type = payload.action_type.trim().to_ascii_lowercase();
    if payload.action_type.is_empty() || payload.action_type.len() > 64 {
        return Err(AppError::validation(
            "actionType must be 1 to 64 characters",
        ));
    }
    if payload.impact_paise < 0 {
        return Err(AppError::validation("impactPaise cannot be negative"));
    }
    if !(-100_000..=10_000).contains(&payload.margin_bps.unwrap_or(0)) {
        return Err(AppError::validation(
            "marginBps is outside the supported range",
        ));
    }
    if !(0..=10_000).contains(&payload.discount_bps.unwrap_or(0)) {
        return Err(AppError::validation("discountBps must be 0 to 10000"));
    }

    let rules = list_rules(db, tenant_id, branch_id).await?;
    let outcome = action_policy(&rules, &payload.action_type, payload.impact_paise);
    let recorded = profit_governance_repository::record_evaluation(
        db,
        tenant_id,
        branch_id,
        NewGovernanceDecision {
            rule_id: outcome.rule_id.as_deref(),
            decision_type: "action",
            source_type: payload.source_type.trim(),
            source_id: payload.source_id.trim(),
            action_type: &payload.action_type,
            decision: outcome.decision,
            status: outcome.status,
            gross_amount_paise: 0,
            discount_paise: 0,
            product_cost_paise: 0,
            staff_cost_paise: 0,
            membership_redemption_paise: 0,
            estimated_profit_paise: 0,
            margin_bps: payload.margin_bps.unwrap_or(0),
            discount_bps: payload.discount_bps.unwrap_or(0),
            impact_paise: payload.impact_paise,
            reason_codes: json!(outcome.reasons),
            message: outcome.message,
            requested_by_user_id: actor_user_id,
            idempotency_key: payload.idempotency_key.trim(),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to record profit governance decision"))?;
    if recorded.replayed
        && (recorded.decision.decision_type != "action"
            || recorded.decision.source_type != payload.source_type.trim()
            || recorded.decision.source_id != payload.source_id.trim()
            || recorded.decision.action_type != payload.action_type
            || recorded.decision.impact_paise != payload.impact_paise
            || recorded.decision.margin_bps != payload.margin_bps.unwrap_or(0)
            || recorded.decision.discount_bps != payload.discount_bps.unwrap_or(0))
    {
        return Err(AppError::conflict(
            "idempotencyKey was already used for a different profit decision",
        ));
    }
    Ok(GovernanceEvaluationResponse {
        decision: recorded.decision,
        approval: recorded.approval,
        replayed: recorded.replayed,
    })
}

pub async fn list_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: GovernanceListQuery,
) -> Result<Vec<GovernanceApproval>, AppError> {
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    if !status.is_empty() && !matches!(status.as_str(), "pending" | "approved" | "rejected") {
        return Err(AppError::validation(
            "status must be pending, approved, or rejected",
        ));
    }
    profit_governance_repository::list_approvals(
        db,
        tenant_id,
        branch_id,
        &status,
        query.limit.unwrap_or(100).clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to load profit governance approvals"))
}

pub async fn review_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    approval_id: &str,
    actor_user_id: &str,
    outcome: &str,
    note: Option<String>,
) -> Result<GovernanceApproval, AppError> {
    if approval_id.trim().is_empty() {
        return Err(AppError::validation("approval id is required"));
    }
    let note = note.unwrap_or_default();
    if note.len() > 500 {
        return Err(AppError::validation("note cannot exceed 500 characters"));
    }
    match profit_governance_repository::review_approval(
        db,
        tenant_id,
        branch_id,
        approval_id,
        actor_user_id,
        outcome,
        note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to review profit governance approval"))?
    {
        ReviewOutcome::NotFound => Err(AppError::not_found("profit governance approval not found")),
        ReviewOutcome::NotPending => Err(AppError::conflict("approval has already been reviewed")),
        ReviewOutcome::SelfApproval => Err(AppError::conflict(
            "the requester cannot approve or reject their own decision",
        )),
        ReviewOutcome::Reviewed(approval) => Ok(approval),
    }
}

pub async fn list_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: GovernanceListQuery,
) -> Result<Vec<GovernanceAuditEvent>, AppError> {
    let event_type = query
        .event_type
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !event_type.is_empty()
        && !matches!(
            event_type.as_str(),
            "rule_saved" | "evaluated" | "approval_requested" | "approved" | "rejected"
        )
    {
        return Err(AppError::validation("invalid audit event type"));
    }
    profit_governance_repository::list_audit(
        db,
        tenant_id,
        branch_id,
        &event_type,
        query.limit.unwrap_or(100).clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to load profit governance audit"))
}

pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<GovernanceSummary, AppError> {
    profit_governance_repository::summary(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load profit governance summary"))
}

pub async fn list_actions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: GovernanceListQuery,
) -> Result<Vec<ProfitAction>, AppError> {
    let status = query
        .status
        .unwrap_or_else(|| "active".to_string())
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        status.as_str(),
        "active" | "all" | "pending" | "approved" | "completed" | "dismissed"
    ) {
        return Err(AppError::validation("invalid action status"));
    }
    let priority = query
        .priority
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !priority.is_empty() && !matches!(priority.as_str(), "high" | "medium" | "low") {
        return Err(AppError::validation("invalid action priority"));
    }
    profit_governance_repository::list_actions(
        db,
        tenant_id,
        branch_id,
        &status,
        &priority,
        query.limit.unwrap_or(100).clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to load profit action queue"))
}

pub async fn create_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    mut payload: ProfitActionCreateRequest,
) -> Result<ProfitAction, AppError> {
    payload.action_type = payload.action_type.trim().to_ascii_lowercase();
    payload.source_type = payload.source_type.trim().to_ascii_lowercase();
    payload.source_id = payload.source_id.trim().to_string();
    payload.priority = Some(
        payload
            .priority
            .unwrap_or_else(|| "medium".to_string())
            .trim()
            .to_ascii_lowercase(),
    );
    if payload.action_type.is_empty() || payload.action_type.len() > 64 {
        return Err(AppError::validation(
            "actionType must be 1 to 64 characters",
        ));
    }
    if payload.title.trim().is_empty() || payload.title.len() > 120 {
        return Err(AppError::validation("title must be 1 to 120 characters"));
    }
    if payload.message.as_deref().unwrap_or_default().len() > 500 {
        return Err(AppError::validation("message cannot exceed 500 characters"));
    }
    if payload.impact_paise.unwrap_or(0) < 0 {
        return Err(AppError::validation("impactPaise cannot be negative"));
    }
    if !matches!(payload.priority.as_deref(), Some("high" | "medium" | "low")) {
        return Err(AppError::validation("invalid priority"));
    }
    if payload.source_type.is_empty() || payload.source_type.len() > 64 {
        return Err(AppError::validation(
            "sourceType must be 1 to 64 characters",
        ));
    }
    if payload.source_id.is_empty() || payload.source_id.len() > 128 {
        return Err(AppError::validation("sourceId must be 1 to 128 characters"));
    }
    if payload
        .payload
        .as_ref()
        .is_some_and(|value| !value.is_object())
    {
        return Err(AppError::validation("payload must be a JSON object"));
    }
    profit_governance_repository::create_action(db, tenant_id, branch_id, actor_user_id, &payload)
        .await
        .map_err(|_| AppError::internal("failed to create profit action"))?
        .ok_or_else(|| AppError::conflict("an action already exists for this source"))
}

pub async fn transition_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_id: &str,
    actor_user_id: &str,
    next_status: &str,
    note: Option<String>,
) -> Result<ProfitAction, AppError> {
    let note = note.unwrap_or_default();
    if note.len() > 500 {
        return Err(AppError::validation("note cannot exceed 500 characters"));
    }
    let action = profit_governance_repository::action_by_id(db, tenant_id, branch_id, action_id)
        .await
        .map_err(|_| AppError::internal("failed to load profit action"))?
        .ok_or_else(|| AppError::not_found("profit action not found"))?;
    if action.status == "pending"
        && matches!(next_status, "approved" | "dismissed")
        && action.approval_id.is_some()
    {
        review_approval(
            db,
            tenant_id,
            branch_id,
            action.approval_id.as_deref().unwrap_or_default(),
            actor_user_id,
            if next_status == "approved" {
                "approved"
            } else {
                "rejected"
            },
            Some(note),
        )
        .await?;
        return profit_governance_repository::action_by_id(db, tenant_id, branch_id, action_id)
            .await
            .map_err(|_| AppError::internal("failed to reload profit action"))?
            .ok_or_else(|| AppError::not_found("profit action not found"));
    }
    match profit_governance_repository::transition_action(
        db,
        tenant_id,
        branch_id,
        action_id,
        actor_user_id,
        next_status,
        note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to update profit action"))?
    {
        ActionTransitionOutcome::NotFound => Err(AppError::not_found("profit action not found")),
        ActionTransitionOutcome::InvalidStatus => Err(AppError::conflict(
            "profit action transition is not allowed",
        )),
        ActionTransitionOutcome::SelfApproval => Err(AppError::conflict(
            "the creator cannot approve their own profit action",
        )),
        ActionTransitionOutcome::Updated(action) => Ok(action),
    }
}

fn validate_rule(payload: &GovernanceRuleSaveRequest) -> Result<(), AppError> {
    if !matches!(
        payload.rule_type.as_str(),
        "margin_safe_discount" | "negative_margin_block" | "profit_action_governance"
    ) {
        return Err(AppError::validation("invalid ruleType"));
    }
    if payload.title.trim().is_empty() || payload.title.len() > 100 {
        return Err(AppError::validation("title must be 1 to 100 characters"));
    }
    if payload.description.as_deref().unwrap_or_default().len() > 500 {
        return Err(AppError::validation(
            "description cannot exceed 500 characters",
        ));
    }
    if !(0..=10_000).contains(&payload.min_margin_bps)
        || !(0..=10_000).contains(&payload.max_discount_bps)
    {
        return Err(AppError::validation(
            "margin and discount basis points must be 0 to 10000",
        ));
    }
    if payload.max_impact_paise < 0 {
        return Err(AppError::validation("maxImpactPaise cannot be negative"));
    }
    if !matches!(
        payload.severity.as_str(),
        "low" | "medium" | "high" | "critical"
    ) {
        return Err(AppError::validation("invalid severity"));
    }
    Ok(())
}

fn validate_identity(
    idempotency_key: &str,
    source_type: &str,
    source_id: &str,
) -> Result<(), AppError> {
    if idempotency_key.trim().is_empty() || idempotency_key.len() > 128 {
        return Err(AppError::validation(
            "idempotencyKey must be 1 to 128 characters",
        ));
    }
    if source_type.trim().is_empty() || source_type.len() > 64 {
        return Err(AppError::validation(
            "sourceType must be 1 to 64 characters",
        ));
    }
    if source_id.trim().is_empty() || source_id.len() > 128 {
        return Err(AppError::validation("sourceId must be 1 to 128 characters"));
    }
    Ok(())
}

fn discount_policy(
    rules: &[GovernanceRule],
    estimated_profit_paise: i64,
    margin_bps: i64,
    discount_bps: i64,
    impact_paise: i64,
) -> PolicyOutcome {
    if estimated_profit_paise < 0 {
        let rule = enabled_rule(rules, "negative_margin_block");
        return PolicyOutcome {
            rule_id: rule.map(|value| value.id.clone()),
            decision: "blocked",
            status: "blocked",
            reasons: vec!["negative_margin"],
            message: "Negative-profit transaction is blocked",
        };
    }

    let rule = enabled_rule(rules, "margin_safe_discount");
    let mut reasons = Vec::new();
    if let Some(rule) = rule {
        if margin_bps < i64::from(rule.min_margin_bps) {
            reasons.push("margin_below_floor");
        }
        if discount_bps > i64::from(rule.max_discount_bps) {
            reasons.push("discount_above_limit");
        }
        if impact_paise > rule.max_impact_paise {
            reasons.push("impact_above_limit");
        }
    }
    policy_from_rule(rule, reasons)
}

fn action_policy(rules: &[GovernanceRule], action_type: &str, impact_paise: i64) -> PolicyOutcome {
    let rule = enabled_rule(rules, "profit_action_governance");
    let mut reasons = Vec::new();
    if SENSITIVE_ACTIONS.contains(&action_type) {
        reasons.push("sensitive_action");
    }
    if rule.is_some_and(|value| impact_paise > value.max_impact_paise) {
        reasons.push("impact_above_limit");
    }
    if rule.is_none() && !reasons.is_empty() {
        return PolicyOutcome {
            rule_id: None,
            decision: "approval_required",
            status: "pending_approval",
            reasons,
            message: "Sensitive profit action requires approval",
        };
    }
    policy_from_rule(rule, reasons)
}

fn policy_from_rule(rule: Option<&GovernanceRule>, reasons: Vec<&'static str>) -> PolicyOutcome {
    let (decision, status, message) = match rule {
        Some(rule) if !reasons.is_empty() && rule.approval_required => (
            "approval_required",
            "pending_approval",
            "Profit governance approval is required",
        ),
        Some(rule) if reasons.is_empty() && rule.auto_execute_allowed => (
            "auto_execute_allowed",
            "allowed",
            "Profit action is within the configured guardrails",
        ),
        _ => ("allowed", "allowed", "Profit action is allowed"),
    };
    PolicyOutcome {
        rule_id: rule.map(|value| value.id.clone()),
        decision,
        status,
        reasons,
        message,
    }
}

fn enabled_rule<'a>(rules: &'a [GovernanceRule], rule_type: &str) -> Option<&'a GovernanceRule> {
    rules
        .iter()
        .find(|rule| rule.enabled && rule.rule_type == rule_type)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::models::profit_governance::GovernanceRule;

    use super::{action_policy, discount_policy};

    fn rule(rule_type: &str) -> GovernanceRule {
        GovernanceRule {
            id: format!("{rule_type}-id"),
            rule_type: rule_type.to_string(),
            title: "Policy".to_string(),
            description: String::new(),
            enabled: true,
            min_margin_bps: 1500,
            max_discount_bps: 2000,
            max_impact_paise: 100_000,
            approval_required: true,
            auto_execute_allowed: false,
            audit_required: true,
            severity: "high".to_string(),
            created_by_user_id: "user".to_string(),
            updated_by_user_id: "user".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn negative_margin_blocks_and_threshold_breach_requires_approval() {
        let rules = vec![rule("negative_margin_block"), rule("margin_safe_discount")];
        let blocked = discount_policy(&rules, -1, -1, 1000, 10_000);
        assert_eq!(blocked.status, "blocked");
        assert_eq!(blocked.reasons, vec!["negative_margin"]);

        let pending = discount_policy(&rules, 10_000, 1000, 2500, 120_000);
        assert_eq!(pending.status, "pending_approval");
        assert_eq!(
            pending.reasons,
            vec![
                "margin_below_floor",
                "discount_above_limit",
                "impact_above_limit"
            ]
        );
    }

    #[test]
    fn sensitive_action_requires_approval_even_before_rule_configuration() {
        let outcome = action_policy(&[], "discount_abuse", 1);
        assert_eq!(outcome.status, "pending_approval");
        assert_eq!(outcome.reasons, vec!["sensitive_action"]);
    }
}
