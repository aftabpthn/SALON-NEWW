use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_concierge_repository::{self as repository, AiWorkforceEvaluationRecord},
    services::ai_concierge_service,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiWorkforceAgent {
    pub key: &'static str,
    pub name: &'static str,
    pub purpose: &'static str,
    pub evidence_sources: &'static [&'static str],
    pub action_workflow: &'static str,
    pub fallback: &'static str,
    pub enabled: bool,
    pub action_owner_user_id: String,
    pub status: &'static str,
}

const AGENTS: &[(&str, &str, &str, &[&str], &str)] = &[
    (
        "receptionist",
        "AI Receptionist",
        "Guest calls, messages and booking drafts",
        &["appointments", "clients", "services"],
        "deterministic receptionist and human handoff",
    ),
    (
        "lead_manager",
        "AI Lead Manager",
        "Lead prioritization and follow-up proposals",
        &["marketing_leads", "communication_timeline"],
        "rule-based lead queue",
    ),
    (
        "digital_marketer",
        "AI Digital Marketer",
        "Consent-safe campaign and offer drafts",
        &["campaign_attribution", "consent", "profit_governance"],
        "deterministic segments and draft-only campaigns",
    ),
    (
        "concierge",
        "AI Concierge",
        "Permission-scoped CRM answers and navigation",
        &["ai_copilot_scope_audit", "crm_tool_evidence"],
        "allow-listed deterministic CRM tools",
    ),
    (
        "retention_manager",
        "AI Retention Manager",
        "Churn, renewal and rebooking recommendations",
        &["visit_history", "memberships", "packages"],
        "rule-based retention outlook",
    ),
    (
        "employee_scheduler",
        "AI Employee Scheduler",
        "Demand and roster-gap recommendations",
        &["appointments", "staff_schedule", "attendance"],
        "scheduled-capacity rules",
    ),
    (
        "inventory_manager",
        "AI Inventory Manager",
        "Reorder, expiry and consumption variance proposals",
        &["inventory_ledger", "recipes", "purchase_orders"],
        "deterministic reorder forecast",
    ),
    (
        "business_advisor",
        "AI Business Advisor",
        "Explainable profit, utilization and risk briefings",
        &["accounting_journals", "profit_intelligence", "reports"],
        "deterministic business briefing",
    ),
    (
        "dispute_manager",
        "AI Dispute Manager",
        "Payment-risk and dispute evidence preparation",
        &["payments", "refunds", "provider_events"],
        "payment risk rules and human review",
    ),
    (
        "staff_sidekick",
        "Staff Sidekick",
        "Self-scoped staff preparation and coaching",
        &["staff_self", "appointments", "training"],
        "permission-scoped staff tools",
    ),
    (
        "scribe",
        "AI Scribe",
        "Consent-gated transcript and reviewed form drafts",
        &["scribe_consent", "form_versions", "appointment_services"],
        "manual notes and form workflow",
    ),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkforceControls {
    pub permission_scoped: bool,
    pub proposal_validation_approval: bool,
    pub dangerous_direct_writes_blocked: bool,
    pub pii_redaction: bool,
    pub booking_confirmation_required: bool,
    pub provider_fallback: bool,
    pub production_data_evaluation_allowed: bool,
    pub max_requests_per_minute: i32,
    pub max_latency_ms: i32,
    pub monthly_cost_budget_paise: i64,
    pub transcript_retention_days: i32,
    pub evaluation_retention_days: i32,
    pub prompt_version: String,
    pub model_allowlist: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkforceSummary {
    pub enabled: bool,
    pub status: &'static str,
    pub controls: WorkforceControls,
    pub agents: Vec<AiWorkforceAgent>,
    pub metrics: repository::AiWorkforceMetricsRecord,
    pub latest_evaluation: Option<AiWorkforceEvaluationRecord>,
}

pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<WorkforceSummary, AppError> {
    let policy = ai_concierge_service::governance(db, tenant_id, branch_id).await?;
    let metrics = repository::workforce_metrics(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load AI workforce metrics"))?;
    let latest_evaluation = repository::latest_workforce_evaluation(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load AI workforce evaluation"))?;
    let status = policy_status(policy.enabled, &policy.default_action_owner_user_id);
    let agents = AGENTS
        .iter()
        .map(|(key, name, purpose, sources, fallback)| AiWorkforceAgent {
            key,
            name,
            purpose,
            evidence_sources: sources,
            action_workflow:
                "proposal → Rust validation → authorized human approval → existing service",
            fallback,
            enabled: policy.enabled && !policy.default_action_owner_user_id.is_empty(),
            action_owner_user_id: policy.default_action_owner_user_id.clone(),
            status,
        })
        .collect();
    Ok(WorkforceSummary {
        enabled: policy.enabled,
        status,
        controls: WorkforceControls {
            permission_scoped: true,
            proposal_validation_approval: true,
            dangerous_direct_writes_blocked: true,
            pii_redaction: policy.redact_sensitive_data,
            booking_confirmation_required: policy.require_booking_confirmation,
            provider_fallback: true,
            production_data_evaluation_allowed: false,
            max_requests_per_minute: policy.max_requests_per_minute,
            max_latency_ms: policy.max_latency_ms,
            monthly_cost_budget_paise: policy.monthly_cost_budget_paise,
            transcript_retention_days: policy.transcript_retention_days,
            evaluation_retention_days: policy.evaluation_retention_days,
            prompt_version: policy.prompt_version,
            model_allowlist: policy.model_allowlist,
        },
        agents,
        metrics,
        latest_evaluation,
    })
}

pub async fn require_enabled_and_consume(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(), AppError> {
    let policy = ai_concierge_service::governance(db, tenant_id, branch_id).await?;
    if !policy.enabled {
        return Err(AppError::forbidden("AI workforce requires tenant opt-in"));
    }
    if policy.default_action_owner_user_id.trim().is_empty() {
        return Err(AppError::conflict(
            "AI workforce requires a default action owner",
        ));
    }
    let count = repository::consume_workforce_request(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to enforce AI request limit"))?;
    if count > i64::from(policy.max_requests_per_minute) {
        return Err(AppError::rate_limited("AI request limit exceeded"));
    }
    Ok(())
}

fn policy_status(enabled: bool, owner: &str) -> &'static str {
    if !enabled {
        "opt_in_required"
    } else if owner.trim().is_empty() {
        "owner_required"
    } else {
        "governed"
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRequest {
    pub suite_version: String,
    pub dataset_digest: String,
    #[serde(default)]
    pub production_data_used: bool,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub prompt_version: String,
    pub unsafe_prompt_tests_passed: bool,
    pub hallucination_tests_passed: bool,
    pub unauthorized_action_tests_passed: bool,
    #[serde(default)]
    pub baseline_metric_bps: Option<i32>,
    #[serde(default)]
    pub observed_metric_bps: Option<i32>,
    #[serde(default)]
    pub sample_size: i32,
    #[serde(default)]
    pub evidence: Vec<String>,
}

pub async fn record_evaluation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: EvaluationRequest,
) -> Result<AiWorkforceEvaluationRecord, AppError> {
    validate_evaluation(&request)?;
    repository::record_workforce_evaluation(
        db,
        tenant_id,
        branch_id,
        request.suite_version.trim(),
        request.dataset_digest.trim(),
        request.model_name.trim(),
        request.prompt_version.trim(),
        request.unsafe_prompt_tests_passed,
        request.hallucination_tests_passed,
        request.unauthorized_action_tests_passed,
        request.baseline_metric_bps,
        request.observed_metric_bps,
        request.sample_size,
        &serde_json::json!(request.evidence),
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to record AI workforce evaluation"))
}

fn validate_evaluation(request: &EvaluationRequest) -> Result<(), AppError> {
    if request.production_data_used {
        return Err(AppError::validation(
            "production data cannot be used in AI evaluation datasets",
        ));
    }
    if request.suite_version.trim().is_empty() || request.suite_version.chars().count() > 80 {
        return Err(AppError::validation(
            "AI evaluation suite version is required",
        ));
    }
    let digest = request.dataset_digest.trim();
    if digest.len() != 64 || !digest.chars().all(|value| value.is_ascii_hexdigit()) {
        return Err(AppError::validation(
            "AI evaluation datasetDigest must be a SHA-256 hex digest",
        ));
    }
    if request.sample_size <= 0 || request.evidence.is_empty() {
        return Err(AppError::validation(
            "AI evaluation sample size and evidence are required",
        ));
    }
    if request
        .evidence
        .iter()
        .any(|value| value.trim().is_empty() || value.chars().count() > 500)
    {
        return Err(AppError::validation("AI evaluation evidence is invalid"));
    }
    if request.baseline_metric_bps.is_some() != request.observed_metric_bps.is_some() {
        return Err(AppError::validation(
            "AI benefit baseline and observed metric must be supplied together",
        ));
    }
    if request
        .baseline_metric_bps
        .zip(request.observed_metric_bps)
        .is_some_and(|(baseline, observed)| observed <= baseline)
    {
        return Err(AppError::validation(
            "AI observed benefit must be better than the baseline",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn workforce_registry_is_complete_and_unique() {
        assert_eq!(AGENTS.len(), 11);
        assert_eq!(
            AGENTS
                .iter()
                .map(|agent| agent.0)
                .collect::<HashSet<_>>()
                .len(),
            11
        );
        assert!(AGENTS.iter().all(|agent| !agent.3.is_empty()));
    }

    #[test]
    fn evaluation_rejects_production_data_and_weak_evidence() {
        let request = EvaluationRequest {
            suite_version: "safety-v1".into(),
            dataset_digest: "a".repeat(64),
            production_data_used: true,
            model_name: String::new(),
            prompt_version: String::new(),
            unsafe_prompt_tests_passed: true,
            hallucination_tests_passed: true,
            unauthorized_action_tests_passed: true,
            baseline_metric_bps: None,
            observed_metric_bps: None,
            sample_size: 1,
            evidence: vec!["synthetic adversarial suite".into()],
        };
        assert!(validate_evaluation(&request).is_err());
    }

    #[test]
    fn evaluation_rejects_benefit_that_does_not_beat_baseline() {
        let request = EvaluationRequest {
            suite_version: "benefit-v1".into(),
            dataset_digest: "a".repeat(64),
            production_data_used: false,
            model_name: "deterministic-test".into(),
            prompt_version: "test-v1".into(),
            unsafe_prompt_tests_passed: true,
            hallucination_tests_passed: true,
            unauthorized_action_tests_passed: true,
            baseline_metric_bps: Some(120),
            observed_metric_bps: Some(120),
            sample_size: 10,
            evidence: vec!["synthetic benefit suite".into()],
        };
        assert!(validate_evaluation(&request).is_err());
    }
}
