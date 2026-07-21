use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GovernanceRuleSaveRequest {
    pub rule_type: String,
    pub title: String,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub min_margin_bps: i32,
    pub max_discount_bps: i32,
    pub max_impact_paise: i64,
    pub approval_required: Option<bool>,
    pub auto_execute_allowed: Option<bool>,
    pub audit_required: Option<bool>,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceRule {
    pub id: String,
    pub rule_type: String,
    pub title: String,
    pub description: String,
    pub enabled: bool,
    pub min_margin_bps: i32,
    pub max_discount_bps: i32,
    pub max_impact_paise: i64,
    pub approval_required: bool,
    pub auto_execute_allowed: bool,
    pub audit_required: bool,
    pub severity: String,
    pub created_by_user_id: String,
    pub updated_by_user_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscountEvaluationRequest {
    pub idempotency_key: String,
    pub source_type: String,
    pub source_id: String,
    pub gross_amount_paise: i64,
    pub discount_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
    pub membership_redemption_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionEvaluationRequest {
    pub idempotency_key: String,
    pub source_type: String,
    pub source_id: String,
    pub action_type: String,
    pub impact_paise: i64,
    pub margin_bps: Option<i64>,
    pub discount_bps: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceDecision {
    pub id: String,
    pub rule_id: Option<String>,
    pub decision_type: String,
    pub source_type: String,
    pub source_id: String,
    pub action_type: String,
    pub decision: String,
    pub status: String,
    pub gross_amount_paise: i64,
    pub discount_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
    pub membership_redemption_paise: i64,
    pub estimated_profit_paise: i64,
    pub margin_bps: i64,
    pub discount_bps: i64,
    pub impact_paise: i64,
    pub reason_codes: Value,
    pub message: String,
    pub requested_by_user_id: String,
    pub idempotency_key: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceApproval {
    pub id: String,
    pub decision_id: String,
    pub decision_type: String,
    pub source_type: String,
    pub source_id: String,
    pub action_type: String,
    pub decision: String,
    pub status: String,
    pub gross_amount_paise: i64,
    pub discount_paise: i64,
    pub estimated_profit_paise: i64,
    pub margin_bps: i64,
    pub discount_bps: i64,
    pub impact_paise: i64,
    pub reason_codes: Value,
    pub message: String,
    pub requested_by_user_id: String,
    pub reviewed_by_user_id: Option<String>,
    pub review_note: String,
    pub requested_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceEvaluationResponse {
    pub decision: GovernanceDecision,
    pub approval: Option<GovernanceApproval>,
    pub replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalReviewRequest {
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceListQuery {
    pub status: Option<String>,
    pub event_type: Option<String>,
    pub priority: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfitActionCreateRequest {
    pub action_type: String,
    pub title: String,
    pub message: Option<String>,
    pub impact_paise: Option<i64>,
    pub priority: Option<String>,
    pub source_type: String,
    pub source_id: String,
    pub payload: Option<Value>,
    pub period_start: Option<NaiveDate>,
    pub period_end: Option<NaiveDate>,
    pub rule_key: Option<String>,
    pub owner_user_id: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
    pub sla_minutes: Option<i32>,
    pub notes: Option<String>,
    pub evidence: Option<Value>,
    pub baseline_impact_paise: Option<i64>,
    pub expected_impact_paise: Option<i64>,
    #[serde(skip)]
    pub action_key: Option<String>,
    #[serde(skip)]
    pub recurrence_key: Option<String>,
    #[serde(skip)]
    pub generated_by: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfitActionTransitionRequest {
    pub note: Option<String>,
    pub evidence: Option<Value>,
    pub realized_impact_paise: Option<i64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProfitAction {
    pub id: String,
    pub governance_decision_id: Option<String>,
    pub approval_id: Option<String>,
    pub action_type: String,
    pub title: String,
    pub message: String,
    pub impact_paise: i64,
    pub priority: String,
    pub status: String,
    pub source_type: String,
    pub source_id: String,
    pub action_key: String,
    pub period_start: Option<NaiveDate>,
    pub period_end: Option<NaiveDate>,
    pub rule_key: String,
    pub owner_user_id: Option<String>,
    pub owner_name: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
    pub sla_minutes: Option<i32>,
    pub notes: String,
    pub evidence_json: Value,
    pub baseline_impact_paise: i64,
    pub expected_impact_paise: i64,
    pub realized_impact_paise: i64,
    pub recurrence_key: Option<String>,
    pub occurrence_number: i32,
    pub generated_by: String,
    pub last_observed_at: Option<DateTime<Utc>>,
    pub payload_json: Value,
    pub created_by_user_id: String,
    pub reviewed_by_user_id: Option<String>,
    pub completed_by_user_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub approved_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub dismissed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceAuditEvent {
    pub id: String,
    pub decision_id: Option<String>,
    pub rule_id: Option<String>,
    pub event_type: String,
    pub actor_user_id: String,
    pub details_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceSummary {
    pub configured_rules: i64,
    pub enabled_rules: i64,
    pub total_evaluations: i64,
    pub pending_approvals: i64,
    pub approved: i64,
    pub rejected: i64,
    pub blocked: i64,
}
