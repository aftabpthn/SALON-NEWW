//! Governance and proactive intelligence for the AI copilot.
//!
//! The target posture is a governed copilot, not an autonomous operator:
//! analysis, forecasting, recommendations and draft creation run on their own,
//! while payment, refund, offer publishing, marketing sends, booking
//! confirmation and payroll changes stop and wait for a named human decision.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_scope_repository::{self as repository, AiCopilotAlertRecord},
    routes::context::current_business_date,
    services::{
        ai_scope_service::{
            self as scope_service, format_money_paise, safe_percent, AiDomain, AnalysisPeriod,
            ResolvedScope, ScopeRequest,
        },
        ai_scoped_copilot_tools,
        auth_service::AuthClaims,
    },
};

/// Alerts below this confidence are dropped rather than shown: a proactive
/// notification that is probably noise costs more attention than it saves.
const ALERT_CONFIDENCE_FLOOR: f64 = 0.5;
/// Percentage falls that count as a decline worth raising.
const REVENUE_DECLINE_THRESHOLD_PERCENT: f64 = 15.0;
const STAFF_DECLINE_THRESHOLD_PERCENT: f64 = 25.0;
const SERVICE_DECLINE_THRESHOLD_PERCENT: f64 = 30.0;
const NO_SHOW_RATE_THRESHOLD_PERCENT: f64 = 15.0;
/// Waste below this rupee value is not worth a standing alert.
const WASTAGE_ALERT_FLOOR_PAISE: i64 = 50_000;

/// Whether an action runs on its own or waits for a person.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalMode {
    /// Analysis, forecasting, recommendations and drafts.
    Auto,
    /// Money movement and anything that reaches a client or a payslip.
    ExplicitApproval,
}

impl ApprovalMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::ExplicitApproval => "explicit_approval",
        }
    }
}

/// Actions the copilot can propose.
///
/// The split is the whole governance rule: everything that only produces
/// information is automatic, everything that moves money or leaves the building
/// is not, regardless of how confident the analysis behind it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopilotAction {
    Payment,
    Refund,
    OfferPublish,
    MarketingSend,
    BookingConfirmation,
    PayrollChange,
    CoachingTaskDraft,
    StockAuditDraft,
    PurchaseDraft,
    ReportDraft,
    Recommendation,
}

impl CopilotAction {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value.trim().to_ascii_lowercase().as_str() {
            "payment" => Self::Payment,
            "refund" => Self::Refund,
            "offer_publish" => Self::OfferPublish,
            "marketing_send" => Self::MarketingSend,
            "booking_confirmation" => Self::BookingConfirmation,
            "payroll_change" => Self::PayrollChange,
            "coaching_task_draft" => Self::CoachingTaskDraft,
            "stock_audit_draft" => Self::StockAuditDraft,
            "purchase_draft" => Self::PurchaseDraft,
            "report_draft" => Self::ReportDraft,
            "recommendation" => Self::Recommendation,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Payment => "payment",
            Self::Refund => "refund",
            Self::OfferPublish => "offer_publish",
            Self::MarketingSend => "marketing_send",
            Self::BookingConfirmation => "booking_confirmation",
            Self::PayrollChange => "payroll_change",
            Self::CoachingTaskDraft => "coaching_task_draft",
            Self::StockAuditDraft => "stock_audit_draft",
            Self::PurchaseDraft => "purchase_draft",
            Self::ReportDraft => "report_draft",
            Self::Recommendation => "recommendation",
        }
    }

    /// The governance decision for this action.
    pub fn approval_mode(self) -> ApprovalMode {
        match self {
            Self::Payment
            | Self::Refund
            | Self::OfferPublish
            | Self::MarketingSend
            | Self::BookingConfirmation
            | Self::PayrollChange => ApprovalMode::ExplicitApproval,
            Self::CoachingTaskDraft
            | Self::StockAuditDraft
            | Self::PurchaseDraft
            | Self::ReportDraft
            | Self::Recommendation => ApprovalMode::Auto,
        }
    }

    /// The permission a person must hold to approve this action.
    pub fn approver_permission(self) -> &'static str {
        match self {
            Self::Payment => "pos.manage",
            Self::Refund => "pos.refund",
            Self::OfferPublish | Self::MarketingSend => "marketing.manage",
            Self::BookingConfirmation => "appointments.manage",
            Self::PayrollChange => "staff.payroll.manage",
            Self::PurchaseDraft => "purchases.manage",
            Self::StockAuditDraft => "inventory.manage",
            Self::CoachingTaskDraft => "staff.manage",
            Self::ReportDraft | Self::Recommendation => "reports.read",
        }
    }

    /// The domain the proposer must already be able to read.
    fn domain(self) -> AiDomain {
        match self {
            Self::Payment | Self::Refund => AiDomain::Finance,
            Self::OfferPublish | Self::MarketingSend => AiDomain::Marketing,
            Self::BookingConfirmation => AiDomain::Appointments,
            Self::PayrollChange | Self::CoachingTaskDraft => AiDomain::Staff,
            Self::StockAuditDraft | Self::PurchaseDraft => AiDomain::Inventory,
            Self::ReportDraft | Self::Recommendation => AiDomain::GeoComparison,
        }
    }
}

/// A copilot proposal awaiting recording or approval.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeActionRequest {
    pub action_type: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub scope: ScopeRequest,
}

/// The decision a human records against a pending proposal.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideActionRequest {
    /// `approved` or `rejected`.
    pub decision: String,
    #[serde(default)]
    pub note: String,
}

/// Record a proposed action under the governance rules.
///
/// Auto-mode work is stored already approved so the audit trail still names it;
/// approval-mode work is stored pending and nothing is executed until someone
/// decides. This function never performs the underlying action itself.
pub async fn propose_action(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    request: &ProposeActionRequest,
) -> Result<repository::AiCopilotApprovalRecord, AppError> {
    let action = CopilotAction::parse(&request.action_type)
        .ok_or_else(|| AppError::validation("unsupported copilot action type"))?;
    if request.title.trim().is_empty() {
        return Err(AppError::validation("action title is required"));
    }

    // Proposing still requires being able to read the domain it touches.
    scope_service::require_domain(claims, action.domain())?;

    let language = scope_service::detect_language("", None);
    let scope =
        scope_service::resolve_scope(db, tenant_id, claims, &request.scope, language.language)
            .await?;
    if scope.is_empty() {
        return Err(AppError::forbidden(
            "no branch is authorized for this login, so no action can be proposed",
        ));
    }

    let mode = action.approval_mode();
    let status = match mode {
        ApprovalMode::Auto => "approved",
        ApprovalMode::ExplicitApproval => "pending",
    };
    let decided_by = match mode {
        ApprovalMode::Auto => "ai-copilot-auto",
        ApprovalMode::ExplicitApproval => "",
    };

    repository::insert_approval(
        db,
        repository::ApprovalInsert {
            tenant_id,
            branch_id: &scope.governance_branch_id(),
            action_type: action.as_str(),
            approval_mode: mode.as_str(),
            title: request.title.trim(),
            summary: request.summary.trim(),
            payload_json: if request.payload.is_null() {
                json!({})
            } else {
                request.payload.clone()
            },
            scope_level: scope.level.as_str(),
            scope_label: &scope.label,
            required_permission: action.approver_permission(),
            status,
            requested_by: &claims.sub,
            requested_role: &claims.role,
            decided_by,
            // Pending money-moving proposals go stale rather than linger forever.
            expires_in_hours: if matches!(mode, ApprovalMode::ExplicitApproval) {
                72
            } else {
                0
            },
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to record copilot action"))
}

/// Approve or reject a pending proposal.
///
/// The decider must hold the action's own permission; being able to ask the
/// copilot a question is never enough to release a payment or a campaign.
pub async fn decide_action(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    approval_id: &str,
    request: &DecideActionRequest,
) -> Result<repository::AiCopilotApprovalRecord, AppError> {
    let status = match request.decision.trim().to_ascii_lowercase().as_str() {
        "approved" | "approve" => "approved",
        "rejected" | "reject" => "rejected",
        _ => {
            return Err(AppError::validation(
                "decision must be approved or rejected",
            ))
        }
    };

    let language = scope_service::detect_language("", None);
    let scope = scope_service::resolve_scope(
        db,
        tenant_id,
        claims,
        &ScopeRequest::default(),
        language.language,
    )
    .await?;
    let branch_ids = scope.branch_ids();

    let existing = repository::approval_by_id(db, tenant_id, &branch_ids, approval_id)
        .await
        .map_err(|_| AppError::internal("failed to load copilot action"))?
        .ok_or_else(|| AppError::not_found("copilot action was not found in your scope"))?;

    let action = CopilotAction::parse(&existing.action_type)
        .ok_or_else(|| AppError::internal("stored copilot action type is unsupported"))?;
    if !holds_permission(claims, action.approver_permission()) {
        return Err(AppError::forbidden(format!(
            "approving this action requires the {} permission",
            action.approver_permission()
        )));
    }
    if existing.status != "pending" {
        return Err(AppError::validation(
            "this copilot action has already been decided",
        ));
    }

    repository::decide_approval(
        db,
        tenant_id,
        &branch_ids,
        approval_id,
        status,
        &claims.sub,
        request.note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to record the approval decision"))?
    .ok_or_else(|| AppError::validation("this copilot action is no longer pending or has expired"))
}

/// Actions visible inside the caller's scope.
pub async fn list_actions(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    status: &str,
) -> Result<Vec<repository::AiCopilotApprovalRecord>, AppError> {
    let language = scope_service::detect_language("", None);
    let scope = scope_service::resolve_scope(
        db,
        tenant_id,
        claims,
        &ScopeRequest::default(),
        language.language,
    )
    .await?;
    repository::list_approvals(db, tenant_id, &scope.branch_ids(), status, 100)
        .await
        .map_err(|_| AppError::internal("failed to load copilot actions"))
}

/// Explicit denial beats everything, then an explicit grant, then the role default.
fn holds_permission(claims: &AuthClaims, permission: &str) -> bool {
    if claims
        .denied_permissions
        .iter()
        .any(|entry| entry == permission)
    {
        return false;
    }
    if claims.permissions.iter().any(|entry| entry == permission) {
        return true;
    }
    // Owners and admins retain implicit management rights when a tenant has not
    // enumerated permissions, matching how the rest of the API treats them.
    matches!(
        claims.role.trim().to_ascii_lowercase().as_str(),
        "owner" | "admin"
    )
}

/// One detected condition before it is written to the alert feed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertCandidate {
    pub alert_type: String,
    pub severity: String,
    pub subject_type: String,
    pub subject_id: String,
    pub subject_name: String,
    pub branch_id: String,
    pub title: String,
    pub detail: String,
    pub metrics: Value,
    pub confidence: f64,
    pub required_permission: String,
}

impl AlertCandidate {
    /// The dedupe key. Deliberately period-free so the same standing condition
    /// updates one row across scans instead of producing a new alert each run.
    fn fingerprint(&self) -> String {
        format!(
            "{}:{}:{}",
            self.alert_type, self.subject_type, self.subject_id
        )
    }
}

/// Outcome of one proactive scan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertScanResult {
    pub scope_label: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub evaluated_count: usize,
    pub suppressed_low_confidence: usize,
    pub alerts: Vec<AiCopilotAlertRecord>,
}

/// Run the proactive scan across everything the caller may read.
///
/// Detection is per-domain and permission-gated: a login that cannot read
/// finance never has a margin alert raised on its behalf.
pub async fn scan_alerts(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    request: &ScopeRequest,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
) -> Result<AlertScanResult, AppError> {
    let language = scope_service::detect_language("", None);
    let scope =
        scope_service::resolve_scope(db, tenant_id, claims, request, language.language).await?;
    if scope.is_empty() {
        return Err(AppError::forbidden(
            "no branch is authorized for this login, so no alerts can be produced",
        ));
    }
    let period = AnalysisPeriod::from_optional(start_date, end_date, current_business_date())?;
    let branch_ids = scope.branch_ids();

    let mut candidates: Vec<AlertCandidate> = Vec::new();
    if scope_service::domain_allowed(claims, AiDomain::GeoComparison) {
        candidates.extend(detect_branch_alerts(db, tenant_id, &branch_ids, &period).await?);
    }
    if scope_service::domain_allowed(claims, AiDomain::Staff) {
        candidates.extend(detect_staff_alerts(db, tenant_id, &branch_ids, &period, &scope).await?);
    }
    if scope_service::domain_allowed(claims, AiDomain::Inventory) {
        candidates.extend(detect_inventory_alerts(db, tenant_id, &branch_ids, &period).await?);
    }
    if scope_service::domain_allowed(claims, AiDomain::Services) {
        candidates.extend(detect_service_alerts(db, tenant_id, &branch_ids, &period).await?);
    }
    if scope_service::domain_allowed(claims, AiDomain::Clients) {
        candidates.extend(detect_client_alerts(db, tenant_id, &branch_ids, &period).await?);
    }
    if scope_service::domain_allowed(claims, AiDomain::Memberships) {
        candidates.extend(detect_membership_alerts(db, tenant_id, &branch_ids).await?);
    }
    if scope_service::domain_allowed(claims, AiDomain::Finance) {
        candidates.extend(detect_finance_alerts(db, tenant_id, &branch_ids, &period).await?);
    }

    let evaluated_count = candidates.len();
    let (keep, suppressed): (Vec<_>, Vec<_>) = candidates
        .into_iter()
        .partition(|candidate| candidate.confidence >= ALERT_CONFIDENCE_FLOOR);

    let mut alerts = Vec::with_capacity(keep.len());
    for candidate in &keep {
        let fingerprint = candidate.fingerprint();
        let record = repository::upsert_alert(
            db,
            repository::AlertUpsert {
                tenant_id,
                branch_id: &candidate.branch_id,
                scope_level: scope.level.as_str(),
                scope_label: &scope.label,
                alert_type: &candidate.alert_type,
                severity: &candidate.severity,
                subject_type: &candidate.subject_type,
                subject_id: &candidate.subject_id,
                subject_name: &candidate.subject_name,
                title: &candidate.title,
                detail: &candidate.detail,
                metrics_json: candidate.metrics.clone(),
                confidence: candidate.confidence,
                required_permission: &candidate.required_permission,
                fingerprint: &fingerprint,
                period_start: period.start_date,
                period_end: period.end_date,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to record copilot alert"))?;
        alerts.push(record);
    }

    Ok(AlertScanResult {
        scope_label: scope.label,
        period_start: period.start_date,
        period_end: period.end_date,
        evaluated_count,
        suppressed_low_confidence: suppressed.len(),
        alerts,
    })
}

/// The alert feed, scoped to the caller's branches and permissions.
pub async fn list_alerts(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    status: &str,
) -> Result<Vec<AiCopilotAlertRecord>, AppError> {
    let language = scope_service::detect_language("", None);
    let scope = scope_service::resolve_scope(
        db,
        tenant_id,
        claims,
        &ScopeRequest::default(),
        language.language,
    )
    .await?;
    let permissions = allowed_alert_permissions(claims);
    repository::list_alerts(
        db,
        tenant_id,
        &scope.branch_ids(),
        &permissions,
        status,
        100,
    )
    .await
    .map_err(|_| AppError::internal("failed to load copilot alerts"))
}

/// Acknowledge or resolve an alert inside the caller's scope.
pub async fn update_alert_status(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    alert_id: &str,
    status: &str,
) -> Result<AiCopilotAlertRecord, AppError> {
    let status = match status.trim().to_ascii_lowercase().as_str() {
        "acknowledged" | "acknowledge" => "acknowledged",
        "resolved" | "resolve" => "resolved",
        "suppressed" | "suppress" => "suppressed",
        _ => {
            return Err(AppError::validation(
                "status must be acknowledged, resolved or suppressed",
            ));
        }
    };
    let language = scope_service::detect_language("", None);
    let scope = scope_service::resolve_scope(
        db,
        tenant_id,
        claims,
        &ScopeRequest::default(),
        language.language,
    )
    .await?;
    repository::set_alert_status(
        db,
        tenant_id,
        &scope.branch_ids(),
        alert_id,
        status,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to update the copilot alert"))?
    .ok_or_else(|| AppError::not_found("copilot alert was not found in your scope"))
}

/// The permissions this login holds among those alerts are tagged with.
fn allowed_alert_permissions(claims: &AuthClaims) -> Vec<String> {
    [
        AiDomain::GeoComparison,
        AiDomain::Staff,
        AiDomain::Inventory,
        AiDomain::Services,
        AiDomain::Clients,
        AiDomain::Memberships,
        AiDomain::Finance,
    ]
    .into_iter()
    .filter(|domain| scope_service::domain_allowed(claims, *domain))
    .map(|domain| domain.required_permission().to_string())
    .collect()
}

async fn detect_branch_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    period: &AnalysisPeriod,
) -> Result<Vec<AlertCandidate>, AppError> {
    let current = repository::branch_period_metrics(
        db,
        tenant_id,
        branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch metrics"))?;
    let previous = repository::branch_period_metrics(
        db,
        tenant_id,
        branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison branch metrics"))?;

    let mut candidates = Vec::new();
    for row in &current {
        let before = previous
            .iter()
            .find(|other| other.branch_id == row.branch_id);
        if let Some(before) = before {
            let change = percent_change(row.revenue_paise, before.revenue_paise);
            if before.revenue_paise > 0 && change <= -REVENUE_DECLINE_THRESHOLD_PERCENT {
                candidates.push(AlertCandidate {
                    alert_type: "branch_revenue_decline".into(),
                    severity: if change <= -30.0 { "high" } else { "medium" }.into(),
                    subject_type: "branch".into(),
                    subject_id: row.branch_id.clone(),
                    subject_name: row.branch_name.clone(),
                    branch_id: row.branch_id.clone(),
                    title: format!("{} revenue fell {:.1}%", row.branch_name, change.abs()),
                    detail: format!(
                        "{} against {} in the previous equivalent period.",
                        format_money_paise(row.revenue_paise),
                        format_money_paise(before.revenue_paise)
                    ),
                    metrics: json!({
                        "currentRevenuePaise": row.revenue_paise,
                        "previousRevenuePaise": before.revenue_paise,
                        "changePercent": change,
                    }),
                    // A larger prior base makes the fall more trustworthy.
                    confidence: confidence_from_base(before.invoice_count),
                    required_permission: AiDomain::GeoComparison.required_permission().into(),
                });
            }
        }

        let booked_total =
            row.completed_appointments + row.cancelled_appointments + row.no_show_appointments;
        let no_show_rate = safe_percent(row.no_show_appointments, booked_total);
        if booked_total >= 20 && no_show_rate >= NO_SHOW_RATE_THRESHOLD_PERCENT {
            candidates.push(AlertCandidate {
                alert_type: "high_no_show_risk".into(),
                severity: if no_show_rate >= 25.0 {
                    "high"
                } else {
                    "medium"
                }
                .into(),
                subject_type: "branch".into(),
                subject_id: row.branch_id.clone(),
                subject_name: row.branch_name.clone(),
                branch_id: row.branch_id.clone(),
                title: format!("{} no-show rate at {:.1}%", row.branch_name, no_show_rate),
                detail: format!(
                    "{} no-shows across {} booked appointments.",
                    row.no_show_appointments, booked_total
                ),
                metrics: json!({
                    "noShowCount": row.no_show_appointments,
                    "bookedCount": booked_total,
                    "noShowRatePercent": no_show_rate,
                }),
                confidence: confidence_from_base(booked_total),
                required_permission: AiDomain::GeoComparison.required_permission().into(),
            });
        }
    }
    Ok(candidates)
}

async fn detect_staff_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    period: &AnalysisPeriod,
    scope: &ResolvedScope,
) -> Result<Vec<AlertCandidate>, AppError> {
    let staff_filter = scope.self_staff_id.as_deref();
    let current = repository::staff_performance(
        db,
        tenant_id,
        branch_ids,
        period.start_date,
        period.end_date,
        staff_filter,
    )
    .await
    .map_err(|_| AppError::internal("failed to load staff performance"))?;
    let previous = repository::staff_performance(
        db,
        tenant_id,
        branch_ids,
        period.previous_start_date,
        period.previous_end_date,
        staff_filter,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison staff performance"))?;

    let mut candidates = Vec::new();
    for row in &current {
        // Never flag someone who was barely rostered: that is a scheduling
        // fact, not a performance one.
        if !ai_scoped_copilot_tools::staff_qualifies_for_verdict(row) {
            continue;
        }
        let Some(before) = previous.iter().find(|other| other.staff_id == row.staff_id) else {
            continue;
        };
        if !ai_scoped_copilot_tools::staff_qualifies_for_verdict(before) {
            continue;
        }
        let now_revenue = row.service_revenue_paise + row.product_revenue_paise;
        let before_revenue = before.service_revenue_paise + before.product_revenue_paise;
        let change = percent_change(now_revenue, before_revenue);
        if before_revenue > 0 && change <= -STAFF_DECLINE_THRESHOLD_PERCENT {
            candidates.push(AlertCandidate {
                alert_type: "staff_performance_decline".into(),
                severity: if change <= -40.0 { "high" } else { "medium" }.into(),
                subject_type: "staff".into(),
                subject_id: row.staff_id.clone(),
                subject_name: row.staff_name.clone(),
                branch_id: row.branch_id.clone(),
                title: format!("{} billed value fell {:.1}%", row.staff_name, change.abs()),
                detail: format!(
                    "{} across {} completed appointments, against {} previously. Utilization is {:.1}%.",
                    format_money_paise(now_revenue),
                    row.completed_appointments,
                    format_money_paise(before_revenue),
                    ai_scoped_copilot_tools::staff_utilization_percent(row),
                ),
                metrics: json!({
                    "currentRevenuePaise": now_revenue,
                    "previousRevenuePaise": before_revenue,
                    "completedAppointments": row.completed_appointments,
                    "scheduledMinutes": row.scheduled_minutes,
                    "workedMinutes": row.worked_minutes,
                    "changePercent": change,
                }),
                confidence: confidence_from_base(before.completed_appointments),
                required_permission: AiDomain::Staff.required_permission().into(),
            });
        }

        if row.target_count > 0 && row.completed_appointments < row.target_count {
            let shortfall = row.target_count - row.completed_appointments;
            candidates.push(AlertCandidate {
                alert_type: "target_miss".into(),
                severity: "medium".into(),
                subject_type: "staff".into(),
                subject_id: row.staff_id.clone(),
                subject_name: row.staff_name.clone(),
                branch_id: row.branch_id.clone(),
                title: format!(
                    "{} is {} services short of target",
                    row.staff_name, shortfall
                ),
                detail: format!(
                    "{} completed against a target of {}.",
                    row.completed_appointments, row.target_count
                ),
                metrics: json!({
                    "completed": row.completed_appointments,
                    "target": row.target_count,
                    "shortfall": shortfall,
                }),
                confidence: confidence_from_base(row.target_count),
                required_permission: AiDomain::Staff.required_permission().into(),
            });
        }
    }
    Ok(candidates)
}

async fn detect_inventory_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    period: &AnalysisPeriod,
) -> Result<Vec<AlertCandidate>, AppError> {
    let variance = repository::consumption_variance(
        db,
        tenant_id,
        branch_ids,
        period.start_date,
        period.end_date,
        repository::ConsumptionGrouping::Product,
    )
    .await
    .map_err(|_| AppError::internal("failed to load consumption variance"))?;
    let stock = repository::stock_positions(
        db,
        tenant_id,
        branch_ids,
        period.start_date,
        period.end_date,
        true,
    )
    .await
    .map_err(|_| AppError::internal("failed to load stock positions"))?;

    let mut candidates = Vec::new();
    for row in &variance {
        if row.variance_cost_paise < WASTAGE_ALERT_FLOOR_PAISE {
            continue;
        }
        let overuse_percent = safe_percent(row.variance_quantity, row.expected_quantity.max(1));
        candidates.push(AlertCandidate {
            alert_type: if overuse_percent >= 50.0 {
                "product_wastage"
            } else {
                "unusual_product_consumption"
            }
            .into(),
            severity: if overuse_percent >= 50.0 {
                "high"
            } else {
                "medium"
            }
            .into(),
            subject_type: "product".into(),
            subject_id: row.group_id.clone(),
            subject_name: row.group_name.clone(),
            branch_id: row.branch_id.clone(),
            title: format!(
                "{} consumed {} above recipe at {}",
                row.group_name, row.variance_quantity, row.branch_name
            ),
            detail: format!(
                "Expected {} {}, recorded {}. Estimated waste cost {}.",
                row.expected_quantity,
                row.unit,
                row.actual_quantity,
                format_money_paise(row.variance_cost_paise)
            ),
            metrics: json!({
                "expectedQuantity": row.expected_quantity,
                "actualQuantity": row.actual_quantity,
                "varianceQuantity": row.variance_quantity,
                "varianceCostPaise": row.variance_cost_paise,
                "usageEvents": row.usage_events,
                "appointmentLinkedEvents": row.linked_appointment_count,
            }),
            // Attribution is only trustworthy when usage is linked to appointments.
            confidence: if row.linked_appointment_count == 0 {
                0.35
            } else {
                confidence_from_base(row.usage_events)
            },
            required_permission: AiDomain::Inventory.required_permission().into(),
        });
    }

    for row in &stock {
        let outflow = row.consumed_quantity + row.sold_quantity;
        candidates.push(AlertCandidate {
            alert_type: "stock_shortage".into(),
            severity: if row.stock_quantity <= 0 { "high" } else { "medium" }.into(),
            subject_type: "product".into(),
            subject_id: row.inventory_item_id.clone(),
            subject_name: row.product_name.clone(),
            branch_id: row.branch_id.clone(),
            title: format!(
                "{} at {} is at or below reorder point",
                row.product_name, row.branch_name
            ),
            detail: format!(
                "{} in stock against a reorder point of {}, with {} units of outflow in the period.",
                row.stock_quantity, row.reorder_point, outflow
            ),
            metrics: json!({
                "stockQuantity": row.stock_quantity,
                "reorderPoint": row.reorder_point,
                "periodOutflow": outflow,
            }),
            // A reorder point with no observed movement is a weaker signal.
            confidence: if outflow > 0 { 0.85 } else { 0.45 },
            required_permission: AiDomain::Inventory.required_permission().into(),
        });
    }
    Ok(candidates)
}

async fn detect_service_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    period: &AnalysisPeriod,
) -> Result<Vec<AlertCandidate>, AppError> {
    let current = repository::service_demand(
        db,
        tenant_id,
        branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service demand"))?;
    let previous = repository::service_demand(
        db,
        tenant_id,
        branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison service demand"))?;

    let mut candidates = Vec::new();
    for row in &current {
        let Some(before) = previous
            .iter()
            .find(|other| other.branch_id == row.branch_id && other.service_id == row.service_id)
        else {
            continue;
        };
        if before.completed_count < 10 {
            continue;
        }
        let change = percent_change(row.completed_count, before.completed_count);
        if change <= -SERVICE_DECLINE_THRESHOLD_PERCENT {
            candidates.push(AlertCandidate {
                alert_type: "service_demand_decline".into(),
                severity: "medium".into(),
                subject_type: "service".into(),
                subject_id: row.service_id.clone(),
                subject_name: row.service_name.clone(),
                branch_id: row.branch_id.clone(),
                title: format!("{} demand fell {:.1}%", row.service_name, change.abs()),
                detail: format!(
                    "{} completed at {} against {} previously.",
                    row.completed_count, row.branch_name, before.completed_count
                ),
                metrics: json!({
                    "currentCompleted": row.completed_count,
                    "previousCompleted": before.completed_count,
                    "changePercent": change,
                }),
                confidence: confidence_from_base(before.completed_count),
                required_permission: AiDomain::Services.required_permission().into(),
            });
        }
    }
    Ok(candidates)
}

async fn detect_client_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    period: &AnalysisPeriod,
) -> Result<Vec<AlertCandidate>, AppError> {
    let rows = repository::client_retention(
        db,
        tenant_id,
        branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load client retention"))?;

    Ok(rows
        .iter()
        .filter(|row| row.churn_risk_clients >= 10)
        .map(|row| AlertCandidate {
            alert_type: "client_churn_opportunity".into(),
            severity: if row.churn_risk_clients >= 50 {
                "high"
            } else {
                "medium"
            }
            .into(),
            subject_type: "branch".into(),
            subject_id: row.branch_id.clone(),
            subject_name: row.branch_name.clone(),
            branch_id: row.branch_id.clone(),
            title: format!(
                "{} has {} clients with no visit in 90 days",
                row.branch_name, row.churn_risk_clients
            ),
            detail: format!(
                "{} clients visited in the period, {} of them returning.",
                row.visiting_clients, row.returning_clients
            ),
            metrics: json!({
                "churnRiskClients": row.churn_risk_clients,
                "visitingClients": row.visiting_clients,
                "returningClients": row.returning_clients,
                "lapsedClients": row.lapsed_clients,
            }),
            confidence: confidence_from_base(row.churn_risk_clients),
            required_permission: AiDomain::Clients.required_permission().into(),
        })
        .collect())
}

async fn detect_membership_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
) -> Result<Vec<AlertCandidate>, AppError> {
    let rows = repository::membership_expiry(db, tenant_id, branch_ids, 30)
        .await
        .map_err(|_| AppError::internal("failed to load membership expiry"))?;

    Ok(rows
        .iter()
        .filter(|row| row.expiring_count > 0)
        .map(|row| AlertCandidate {
            alert_type: "membership_expiry".into(),
            severity: if row.expiring_count >= 25 {
                "high"
            } else {
                "medium"
            }
            .into(),
            subject_type: "membership".into(),
            subject_id: row.membership_id.clone(),
            subject_name: row.membership_name.clone(),
            branch_id: row.branch_id.clone(),
            title: format!(
                "{} memberships of {} expire within 30 days",
                row.expiring_count, row.membership_name
            ),
            detail: format!(
                "{} active and {} already expired at {}.",
                row.active_count, row.expired_count, row.branch_name
            ),
            metrics: json!({
                "expiringCount": row.expiring_count,
                "expiredCount": row.expired_count,
                "activeCount": row.active_count,
            }),
            confidence: confidence_from_base(row.expiring_count),
            required_permission: AiDomain::Memberships.required_permission().into(),
        })
        .collect())
}

async fn detect_finance_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    period: &AnalysisPeriod,
) -> Result<Vec<AlertCandidate>, AppError> {
    let current = repository::finance_summary(
        db,
        tenant_id,
        branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load finance summary"))?;
    let previous = repository::finance_summary(
        db,
        tenant_id,
        branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison finance summary"))?;

    let contribution = |row: &repository::FinanceSummaryRow| {
        row.revenue_paise - row.refund_paise - row.product_cost_paise - row.expense_paise
    };

    Ok(current
        .iter()
        .filter_map(|row| {
            let before = previous
                .iter()
                .find(|other| other.branch_id == row.branch_id)?;
            let now = contribution(row);
            let then = contribution(before);
            let change = percent_change(now, then);
            (then > 0 && change <= -REVENUE_DECLINE_THRESHOLD_PERCENT).then(|| AlertCandidate {
                alert_type: "margin_loss".into(),
                severity: if change <= -30.0 { "high" } else { "medium" }.into(),
                subject_type: "branch".into(),
                subject_id: row.branch_id.clone(),
                subject_name: row.branch_name.clone(),
                branch_id: row.branch_id.clone(),
                title: format!("{} contribution fell {:.1}%", row.branch_name, change.abs()),
                detail: format!(
                    "{} after refunds, product cost and expenses, against {} previously.",
                    format_money_paise(now),
                    format_money_paise(then)
                ),
                metrics: json!({
                    "currentContributionPaise": now,
                    "previousContributionPaise": then,
                    "revenuePaise": row.revenue_paise,
                    "productCostPaise": row.product_cost_paise,
                    "expensePaise": row.expense_paise,
                    "changePercent": change,
                }),
                confidence: 0.7,
                required_permission: AiDomain::Finance.required_permission().into(),
            })
        })
        .collect())
}

/// Signed percentage change, treating a zero base as no change rather than infinite.
fn percent_change(current: i64, previous: i64) -> f64 {
    if previous == 0 {
        return 0.0;
    }
    ((current - previous) as f64 / previous.abs() as f64) * 100.0
}

/// How much a comparison can be trusted, from the size of the prior-period base.
fn confidence_from_base(base: i64) -> f64 {
    if base <= 0 {
        return 0.2;
    }
    (0.35 + (base as f64 / 60.0)).min(0.95)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_moving_actions_require_explicit_approval() {
        for action in [
            CopilotAction::Payment,
            CopilotAction::Refund,
            CopilotAction::OfferPublish,
            CopilotAction::MarketingSend,
            CopilotAction::BookingConfirmation,
            CopilotAction::PayrollChange,
        ] {
            assert_eq!(
                action.approval_mode(),
                ApprovalMode::ExplicitApproval,
                "{} must not run automatically",
                action.as_str()
            );
        }
    }

    #[test]
    fn analysis_and_drafts_run_automatically() {
        for action in [
            CopilotAction::Recommendation,
            CopilotAction::ReportDraft,
            CopilotAction::CoachingTaskDraft,
            CopilotAction::StockAuditDraft,
            CopilotAction::PurchaseDraft,
        ] {
            assert_eq!(
                action.approval_mode(),
                ApprovalMode::Auto,
                "{} should not need approval",
                action.as_str()
            );
        }
    }

    #[test]
    fn action_names_round_trip() {
        for name in [
            "payment",
            "refund",
            "offer_publish",
            "marketing_send",
            "booking_confirmation",
            "payroll_change",
            "coaching_task_draft",
            "stock_audit_draft",
            "purchase_draft",
            "report_draft",
            "recommendation",
        ] {
            let action = CopilotAction::parse(name).expect("known action");
            assert_eq!(action.as_str(), name);
        }
    }

    #[test]
    fn unknown_actions_are_rejected() {
        assert!(CopilotAction::parse("delete_tenant").is_none());
    }

    #[test]
    fn refund_approval_needs_the_refund_permission() {
        assert_eq!(CopilotAction::Refund.approver_permission(), "pos.refund");
        assert_eq!(
            CopilotAction::PayrollChange.approver_permission(),
            "staff.payroll.manage"
        );
    }

    #[test]
    fn fingerprint_ignores_the_period_so_rescans_dedupe() {
        let candidate = AlertCandidate {
            alert_type: "stock_shortage".into(),
            severity: "high".into(),
            subject_type: "product".into(),
            subject_id: "item-1".into(),
            subject_name: "Developer".into(),
            branch_id: "branch-1".into(),
            title: String::new(),
            detail: String::new(),
            metrics: json!({}),
            confidence: 0.9,
            required_permission: "inventory.read".into(),
        };
        assert_eq!(candidate.fingerprint(), "stock_shortage:product:item-1");
    }

    #[test]
    fn percent_change_handles_a_zero_base() {
        assert_eq!(percent_change(100, 0), 0.0);
        assert_eq!(percent_change(80, 100), -20.0);
    }

    #[test]
    fn confidence_grows_with_the_comparison_base() {
        assert!(confidence_from_base(0) < confidence_from_base(10));
        assert!(confidence_from_base(10) < confidence_from_base(120));
        assert!(confidence_from_base(100_000) <= 0.95);
    }

    #[test]
    fn thin_evidence_falls_below_the_alert_floor() {
        assert!(confidence_from_base(0) < ALERT_CONFIDENCE_FLOOR);
        assert!(confidence_from_base(30) >= ALERT_CONFIDENCE_FLOOR);
    }
}
