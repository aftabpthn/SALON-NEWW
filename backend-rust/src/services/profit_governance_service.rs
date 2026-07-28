use chrono::{Datelike, NaiveDate, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
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
        self, ActionTransitionOutcome, AutomatedActionObservation, NewGovernanceDecision,
        ReviewOutcome,
    },
    services::analytics_service,
};

const SENSITIVE_ACTIONS: &[&str] = &[
    "pricing_recommendation",
    "discount_abuse",
    "high_wastage",
    "membership_liability_risk",
    "low_margin_service",
    "high_expense",
];

pub(crate) struct PolicyOutcome {
    pub(crate) rule_id: Option<String>,
    pub(crate) decision: &'static str,
    pub(crate) status: &'static str,
    pub(crate) reasons: Vec<&'static str>,
    pub(crate) message: &'static str,
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
    payload.rule_key = Some(
        payload
            .rule_key
            .unwrap_or_else(|| "manual".to_string())
            .trim()
            .to_ascii_lowercase(),
    );
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
    if payload.period_start.is_some() != payload.period_end.is_some()
        || payload
            .period_start
            .zip(payload.period_end)
            .is_some_and(|(from, to)| from > to)
    {
        return Err(AppError::validation(
            "periodStart and periodEnd must form a valid date range",
        ));
    }
    if !matches!(payload.sla_minutes, None | Some(1..=525_600)) {
        return Err(AppError::validation("slaMinutes must be 1 to 525600"));
    }
    if payload.notes.as_deref().unwrap_or_default().len() > 4000 {
        return Err(AppError::validation("notes cannot exceed 4000 characters"));
    }
    if payload
        .evidence
        .as_ref()
        .is_some_and(|value| !value.is_object())
    {
        return Err(AppError::validation("evidence must be a JSON object"));
    }
    if [payload.baseline_impact_paise, payload.expected_impact_paise]
        .into_iter()
        .flatten()
        .any(|value| value < 0)
    {
        return Err(AppError::validation(
            "baseline and expected impact cannot be negative",
        ));
    }
    let rule_key = payload
        .rule_key
        .clone()
        .unwrap_or_else(|| "manual".to_string());
    if rule_key.is_empty() || rule_key.len() > 64 {
        return Err(AppError::validation("ruleKey must be 1 to 64 characters"));
    }
    let requested_owner = payload.owner_user_id.clone();
    let actor_can_own = profit_governance_repository::user_can_own_action(
        db,
        tenant_id,
        branch_id,
        requested_owner.as_deref().unwrap_or(actor_user_id),
    )
    .await
    .map_err(|_| AppError::internal("failed to validate profit action owner"))?;
    let owner_user_id = if actor_can_own {
        requested_owner.unwrap_or_else(|| actor_user_id.to_string())
    } else if requested_owner.is_some() {
        return Err(AppError::validation(
            "ownerUserId is not active in this branch",
        ));
    } else {
        profit_governance_repository::profit_action_owner(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to resolve profit action owner"))?
            .ok_or_else(|| AppError::validation("no active user can own this profit action"))?
    };
    payload.owner_user_id = Some(owner_user_id);
    payload.sla_minutes = Some(
        payload
            .sla_minutes
            .unwrap_or_else(|| sla_minutes(payload.priority.as_deref().unwrap_or("medium"))),
    );
    payload.action_key = Some(period_action_key(
        &payload.source_type,
        &payload.source_id,
        payload.period_start.zip(payload.period_end),
        &rule_key,
    ));
    payload.recurrence_key = Some(action_recurrence_key(
        &payload.source_type,
        &payload.source_id,
        &rule_key,
    ));
    payload.generated_by = Some("manual".to_string());
    profit_governance_repository::create_action(db, tenant_id, branch_id, actor_user_id, &payload)
        .await
        .map_err(|_| AppError::internal("failed to create profit action"))?
        .ok_or_else(|| {
            AppError::conflict("an action already exists for this source, period, and rule")
        })
}

pub async fn transition_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_id: &str,
    actor_user_id: &str,
    next_status: &str,
    note: Option<String>,
    realized_impact_paise: Option<i64>,
    evidence: Option<Value>,
) -> Result<ProfitAction, AppError> {
    let note = note.unwrap_or_default();
    if note.len() > 500 {
        return Err(AppError::validation("note cannot exceed 500 characters"));
    }
    if realized_impact_paise.is_some_and(|value| value < 0) {
        return Err(AppError::validation(
            "realizedImpactPaise cannot be negative",
        ));
    }
    if realized_impact_paise.is_some() && next_status != "completed" {
        return Err(AppError::validation(
            "realizedImpactPaise is only accepted when completing an action",
        ));
    }
    if evidence.as_ref().is_some_and(|value| !value.is_object()) {
        return Err(AppError::validation("evidence must be a JSON object"));
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
        realized_impact_paise,
        evidence,
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

struct ProfitActionCandidate {
    action_type: String,
    title: String,
    message: String,
    impact_paise: i64,
    priority: String,
    source_type: String,
    source_id: String,
    margin_bps: i64,
    discount_bps: i64,
    evidence: Value,
}

pub async fn process_automated_action_queue(db: &PgPool) -> Result<usize, AppError> {
    let targets = profit_governance_repository::claim_profit_scan_targets(db, 10)
        .await
        .map_err(|_| AppError::internal("failed to claim scheduled profit scans"))?;
    let mut completed = 0;
    for target in targets {
        match scan_profit_branch(db, &target.tenant_id, &target.branch_id).await {
            Ok(()) => completed += 1,
            Err(error) => {
                let detail = format!("{error:?}");
                if profit_governance_repository::fail_profit_scan(
                    db,
                    &target.tenant_id,
                    &target.branch_id,
                    &detail,
                )
                .await
                .is_err()
                {
                    tracing::warn!(
                        tenant_id = %target.tenant_id,
                        branch_id = %target.branch_id,
                        "failed to release profit scan lease"
                    );
                }
                tracing::warn!(
                    tenant_id = %target.tenant_id,
                    branch_id = %target.branch_id,
                    error = %detail,
                    "scheduled profit scan failed"
                );
            }
        }
    }
    Ok(completed)
}

async fn scan_profit_branch(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<(), AppError> {
    let period_end = Utc::now().date_naive();
    let period_start = period_end
        .with_day(1)
        .expect("every calendar month has a first day");
    let branch_ids = vec![branch_id.to_string()];
    let report = analytics_service::advanced_profit_intelligence(
        db,
        tenant_id,
        &branch_ids,
        "branch",
        period_start,
        period_end,
    )
    .await?;
    let candidates = if report.recommendations_blocked {
        Vec::new()
    } else {
        profit_action_candidates(&report, period_start, period_end)
    };
    if candidates.is_empty() {
        profit_governance_repository::finish_profit_scan(
            db,
            tenant_id,
            branch_id,
            period_start,
            period_end,
            0,
        )
        .await
        .map_err(|_| AppError::internal("failed to complete scheduled profit scan"))?;
        return Ok(());
    }

    let Some(owner_user_id) =
        profit_governance_repository::profit_action_owner(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to resolve profit action owner"))?
    else {
        tracing::info!(
            tenant_id = %tenant_id,
            branch_id = %branch_id,
            action_count = candidates.len(),
            "skipping automated profit actions because no active owner user is available"
        );
        profit_governance_repository::finish_profit_scan(
            db,
            tenant_id,
            branch_id,
            period_start,
            period_end,
            0,
        )
        .await
        .map_err(|_| AppError::internal("failed to complete scheduled profit scan"))?;
        return Ok(());
    };
    for candidate in &candidates {
        observe_profit_action(
            db,
            tenant_id,
            branch_id,
            &owner_user_id,
            period_start,
            period_end,
            candidate,
        )
        .await?;
    }
    profit_governance_repository::finish_profit_scan(
        db,
        tenant_id,
        branch_id,
        period_start,
        period_end,
        candidates.len() as i32,
    )
    .await
    .map_err(|_| AppError::internal("failed to complete scheduled profit scan"))?;
    Ok(())
}

fn profit_action_candidates(
    report: &analytics_service::AdvancedProfitIntelligence,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Vec<ProfitActionCandidate> {
    let mut candidates = Vec::with_capacity(
        report.leaks.len()
            + report.pricing.len()
            + report.liability_risks.len()
            + report.branch_profit.len(),
    );
    for leak in &report.leaks {
        let metrics = report
            .service_profit
            .iter()
            .find(|row| row.entity_id == leak.source_id);
        let gross = metrics
            .map(|row| row.revenue_paise.saturating_add(row.discount_paise))
            .unwrap_or(0);
        candidates.push(ProfitActionCandidate {
            action_type: match leak.kind.as_str() {
                "negative_margin" => "low_margin_service",
                "recipe_variance" => "high_wastage",
                other => other,
            }
            .to_string(),
            title: truncate_text(&leak.title, 120),
            message: truncate_text(&leak.message, 500),
            impact_paise: leak.impact_paise,
            priority: leak.severity.clone(),
            source_type: leak.source_type.clone(),
            source_id: leak.source_id.clone(),
            margin_bps: metrics.map(|row| row.margin_bps).unwrap_or(0),
            discount_bps: metrics
                .filter(|_| gross > 0)
                .map(|row| row.discount_paise.saturating_mul(10_000) / gross)
                .unwrap_or(0),
            evidence: json!({
                "source": "advanced_profit_intelligence",
                "signal": leak.kind,
                "observedImpactPaise": leak.impact_paise,
                "periodStart": period_start,
                "periodEnd": period_end,
                "observedAt": Utc::now(),
            }),
        });
    }
    candidates.extend(report.pricing.iter().map(|row| ProfitActionCandidate {
        action_type: "pricing_recommendation".to_string(),
        title: truncate_text(&format!("Review {} price", row.service_name), 120),
        message: truncate_text(
            &format!(
                "Recorded cost supports a {}% target margin",
                row.target_margin_bps / 100
            ),
            500,
        ),
        impact_paise: row.expected_profit_lift_paise,
        priority: priority(row.expected_profit_lift_paise).to_string(),
        source_type: "service".to_string(),
        source_id: row.service_id.clone(),
        margin_bps: row.current_margin_bps,
        discount_bps: 0,
        evidence: json!({
            "source": "advanced_profit_intelligence",
            "signal": "pricing_recommendation",
            "currentAveragePricePaise": row.current_average_price_paise,
            "suggestedPricePaise": row.suggested_price_paise,
            "targetMarginBps": row.target_margin_bps,
            "observedImpactPaise": row.expected_profit_lift_paise,
            "periodStart": period_start,
            "periodEnd": period_end,
            "observedAt": Utc::now(),
        }),
    }));
    candidates.extend(
        report
            .liability_risks
            .iter()
            .filter(|row| row.severity != "low" && row.remaining_liability_paise > 0)
            .map(|row| {
                let impact_paise = row
                    .projected_cost_paise
                    .max(row.expected_future_profit_paise.saturating_neg());
                ProfitActionCandidate {
                    action_type: "membership_liability_risk".to_string(),
                    title: truncate_text(&format!("Review {} liability", row.plan_name), 120),
                    message: truncate_text(&row.recommendation, 500),
                    impact_paise,
                    priority: row.severity.clone(),
                    source_type: row.kind.clone(),
                    source_id: row.plan_id.clone(),
                    margin_bps: if row.remaining_liability_paise > 0 {
                        row.expected_future_profit_paise.saturating_mul(10_000)
                            / row.remaining_liability_paise
                    } else {
                        0
                    },
                    discount_bps: 0,
                    evidence: json!({
                        "source": "advanced_profit_intelligence",
                        "signal": "membership_liability_risk",
                        "soldValuePaise": row.sold_value_paise,
                        "recognizedValuePaise": row.recognized_value_paise,
                        "remainingLiabilityPaise": row.remaining_liability_paise,
                        "projectedCostPaise": row.projected_cost_paise,
                        "expectedFutureProfitPaise": row.expected_future_profit_paise,
                        "observedImpactPaise": impact_paise,
                        "periodStart": period_start,
                        "periodEnd": period_end,
                        "observedAt": Utc::now(),
                    }),
                }
            }),
    );
    candidates.extend(report.branch_profit.iter().filter_map(|row| {
        if row.revenue_paise <= 0 {
            return None;
        }
        let overhead_bps = row.overhead_cost_paise.saturating_mul(10_000) / row.revenue_paise;
        let excess_overhead_paise = row
            .overhead_cost_paise
            .saturating_sub(row.revenue_paise.saturating_mul(1_500) / 10_000);
        if overhead_bps < 1_500 || excess_overhead_paise <= 0 {
            return None;
        }
        Some(ProfitActionCandidate {
            action_type: "high_expense".to_string(),
            title: truncate_text(&format!("Review {} overhead", row.entity_name), 120),
            message: "Allocated overhead exceeds 15% of recorded Micro P&L revenue".to_string(),
            impact_paise: excess_overhead_paise,
            priority: priority(excess_overhead_paise).to_string(),
            source_type: "branch".to_string(),
            source_id: row.entity_id.clone(),
            margin_bps: row.fully_loaded_margin_bps,
            discount_bps: 0,
            evidence: json!({
                "source": "advanced_profit_intelligence",
                "signal": "high_expense",
                "revenuePaise": row.revenue_paise,
                "overheadCostPaise": row.overhead_cost_paise,
                "overheadBps": overhead_bps,
                "thresholdBps": 1_500,
                "observedImpactPaise": excess_overhead_paise,
                "periodStart": period_start,
                "periodEnd": period_end,
                "observedAt": Utc::now(),
            }),
        })
    }));
    candidates
}

async fn observe_profit_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    owner_user_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    candidate: &ProfitActionCandidate,
) -> Result<(), AppError> {
    let rule_key = candidate.action_type.as_str();
    let recurrence_key =
        action_recurrence_key(&candidate.source_type, &candidate.source_id, rule_key);
    let action_key = period_action_key(
        &candidate.source_type,
        &candidate.source_id,
        Some((period_start, period_end)),
        rule_key,
    );
    if profit_governance_repository::refresh_automated_action(
        db,
        tenant_id,
        branch_id,
        &action_key,
        &candidate.title,
        &candidate.message,
        candidate.impact_paise,
        candidate.evidence.clone(),
    )
    .await
    .map_err(|_| AppError::internal("failed to refresh automated profit action"))?
    {
        return Ok(());
    }
    let governance = evaluate_action(
        db,
        tenant_id,
        branch_id,
        owner_user_id,
        ActionEvaluationRequest {
            idempotency_key: format!("profit-scan:{action_key}"),
            source_type: candidate.source_type.clone(),
            source_id: candidate.source_id.clone(),
            action_type: candidate.action_type.clone(),
            impact_paise: candidate.impact_paise,
            margin_bps: Some(candidate.margin_bps),
            discount_bps: Some(candidate.discount_bps),
        },
    )
    .await?;
    profit_governance_repository::enrich_automated_action(
        db,
        tenant_id,
        branch_id,
        owner_user_id,
        AutomatedActionObservation {
            governance_decision_id: &governance.decision.id,
            action_key: &action_key,
            recurrence_key: &recurrence_key,
            rule_key,
            action_type: &candidate.action_type,
            title: &candidate.title,
            message: &candidate.message,
            impact_paise: candidate.impact_paise,
            priority: &candidate.priority,
            source_type: &candidate.source_type,
            source_id: &candidate.source_id,
            period_start,
            period_end,
            owner_user_id,
            sla_minutes: sla_minutes(&candidate.priority),
            evidence: candidate.evidence.clone(),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to materialize automated profit action"))?
    .ok_or_else(|| AppError::internal("governance did not create a profit action"))?;
    Ok(())
}

fn priority(impact_paise: i64) -> &'static str {
    if impact_paise >= 500_000 {
        "high"
    } else if impact_paise >= 100_000 {
        "medium"
    } else {
        "low"
    }
}

fn sla_minutes(priority: &str) -> i32 {
    match priority {
        "high" => 1_440,
        "low" => 10_080,
        _ => 4_320,
    }
}

fn stable_key(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn period_action_key(
    source_type: &str,
    source_id: &str,
    period: Option<(NaiveDate, NaiveDate)>,
    rule_key: &str,
) -> String {
    let period_key = period
        .map(|(from, to)| format!("{from}:{to}"))
        .unwrap_or_else(|| "manual".to_string());
    stable_key(&format!(
        "{source_type}:{source_id}:{period_key}:{rule_key}"
    ))
}

fn action_recurrence_key(source_type: &str, source_id: &str, rule_key: &str) -> String {
    stable_key(&format!("{source_type}:{source_id}:{rule_key}"))
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
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

/// Decides a discount against the configured rules.
///
/// Pure by design: it takes the rules and the numbers and returns a verdict
/// without touching the database. That is what lets a read-only what-if reach
/// the same decision the recorded evaluation would, instead of reimplementing
/// the policy and drifting from it.
pub(crate) fn discount_policy(
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
    use chrono::{NaiveDate, Utc};

    use crate::models::profit_governance::GovernanceRule;

    use super::{action_policy, action_recurrence_key, discount_policy, period_action_key};

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

    #[test]
    fn period_key_suppresses_same_period_and_allows_recurring_periods() {
        let january = (
            NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
        );
        let february = (
            NaiveDate::from_ymd_opt(2026, 2, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 2, 28).unwrap(),
        );
        let first = period_action_key("service", "svc-1", Some(january), "low_margin_service");
        assert_eq!(
            first,
            period_action_key("service", "svc-1", Some(january), "low_margin_service")
        );
        assert_ne!(
            first,
            period_action_key("service", "svc-1", Some(february), "low_margin_service")
        );
        assert_eq!(
            action_recurrence_key("service", "svc-1", "low_margin_service"),
            action_recurrence_key("service", "svc-1", "low_margin_service")
        );
    }
}
