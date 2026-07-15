use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_enterprise_repository::*,
    },
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        staff_enterprise_service::{
            self, ApprovalDetail, ApprovalPolicyRequest, ApprovalRequestInput, BestStaffRequest,
            CoachingGoalRequest, ComplianceExport, DecisionRequest, IntelligenceRiskRow,
            ManpowerForecastResult, NotificationDeliveryRequest, NotificationPreferenceRequest,
            NotificationTemplateRequest, QueueNotificationRequest, RankedStaffCandidate,
            ReplacementRecommendationResponse, ReplacementRequest, RosterCoverageResponse,
            RosterOptimizeRequest, SalaryRevisionRequest, StaffEnterpriseCommandCenter,
            StaffSalesReport, StatutoryCalculationRequest, StatutoryRuleRequest, StatutorySummary,
            TipPayoutRequest, TrainingAssignmentRequest, VersionRequest,
        },
        staff_payroll_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff/approval-policies",
            get(list_policies).post(create_policy),
        )
        .route(
            "/staff/approvals",
            get(list_approvals).post(create_approval),
        )
        .route("/staff/approvals/:id", get(get_approval))
        .route("/staff/approvals/:id/decision", post(decide_approval))
        .route("/staff/audit", get(list_audit))
        .route("/staff/self/dashboard", get(self_dashboard))
        .route("/staff/self/payslips/:run_id", get(self_payslip))
        .route("/staff/tips", get(list_tips))
        .route("/staff/tips/summary", get(tip_summary))
        .route("/staff/tips/payouts", post(record_tip_payout))
        .route(
            "/staff/payroll-compliance/rules",
            get(list_rules).post(create_rule),
        )
        .route(
            "/staff/payroll-compliance/calculate",
            post(calculate_statutory),
        )
        .route("/staff/payroll-compliance/summary", get(statutory_summary))
        .route("/staff/payroll-compliance/export", post(compliance_export))
        .route(
            "/staff/:staff_id/salary-revisions",
            get(list_salary_revisions).post(create_salary_revision),
        )
        .route(
            "/staff/salary-revisions/:id/decision",
            post(decide_salary_revision),
        )
        .route("/staff/roster/optimize", post(optimize_roster))
        .route("/staff/roster/drafts/:id/apply", post(apply_roster))
        .route("/staff/roster/coverage", get(roster_coverage))
        .route("/staff/roster/gaps", get(roster_coverage))
        .route("/staff/manpower/forecast", get(manpower_forecast))
        .route("/staff/manpower/recalculate", post(recalculate_manpower))
        .route(
            "/staff/manpower/hiring-recommendations",
            get(manpower_forecast),
        )
        .route("/staff/replacement/recommend", post(recommend_replacement))
        .route("/staff/replacement/history", get(replacement_history))
        .route("/staff/replacement/:id/decision", post(decide_replacement))
        .route("/staff/intelligence/burnout-risk", get(burnout_risk))
        .route("/staff/intelligence/retention-risk", get(retention_risk))
        .route("/staff/intelligence/churn-risk", get(retention_risk))
        .route("/staff/intelligence/best-staff", post(best_staff))
        .route(
            "/staff/intelligence/replacement-suggestion",
            post(best_staff),
        )
        .route("/staff/reports/sales", get(staff_sales_report))
        .route("/reports/staff-sales", get(staff_sales_report))
        .route("/staff/reports/:report_type", get(operational_report))
        .route(
            "/staff/:staff_id/notification-preferences",
            get(notification_preference).put(save_notification_preference),
        )
        .route(
            "/staff/notification-templates",
            get(list_notification_templates).post(create_notification_template),
        )
        .route(
            "/staff/notifications",
            get(list_notification_queue).post(queue_notification),
        )
        .route(
            "/staff/notifications/:id/approve",
            post(approve_notification),
        )
        .route(
            "/staff/notifications/:id/delivery-result",
            post(record_notification_delivery),
        )
        .route("/staff/notifications/:id/retry", post(retry_notification))
        .route("/staff/notification-delivery-logs", get(notification_logs))
        .route(
            "/staff-enterprise/command-center",
            get(enterprise_command_center),
        )
        .route("/staff-enterprise/digital-twins", get(staff_digital_twins))
        .route(
            "/staff-enterprise/digital-twins/:staff_id",
            get(staff_digital_twin),
        )
        .route("/staff-enterprise/skill-matrix", get(staff_skill_matrix))
        .route("/staff-enterprise/floor-control", get(floor_control))
        .route("/staff-enterprise/training", get(training_assignments))
        .route("/staff-enterprise/training/assign", post(assign_training))
        .route("/staff/coach/insights", get(coaching_insights))
        .route(
            "/staff/coach/goals",
            get(list_coaching_goals).post(create_coaching_goal),
        )
        .route(
            "/staff/coach/actions/:id/complete",
            post(complete_coaching_action),
        )
        .route("/staff-os/coach/insights", get(coaching_insights))
        .route(
            "/staff-os/coach/goals",
            get(list_coaching_goals).post(create_coaching_goal),
        )
        .route(
            "/staff-os/coach/actions/:id/complete",
            post(complete_coaching_action),
        )
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditQuery {
    event_prefix: Option<String>,
}
#[derive(Deserialize)]
struct SelfQuery {
    date: Option<NaiveDate>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeriodQuery {
    staff_id: Option<String>,
    period_start: NaiveDate,
    period_end: NaiveDate,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryQuery {
    period_start: NaiveDate,
    period_end: NaiveDate,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SalesReportQuery {
    period_start: NaiveDate,
    period_end: NaiveDate,
    page: Option<i64>,
    page_size: Option<i64>,
}

#[derive(Deserialize)]
struct NotificationQueueQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationLogQuery {
    queue_id: Option<String>,
}

#[derive(Deserialize)]
struct FloorControlQuery {
    date: NaiveDate,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoachingGoalQuery {
    staff_id: Option<String>,
    status: Option<String>,
}

async fn list_policies(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Vec<ApprovalPolicyRecord>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_policies(&s.db, &t, &b).await?,
    )))
}
async fn create_policy(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<ApprovalPolicyRequest>,
) -> ApiResult<ApprovalPolicyRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r = staff_enterprise_service::create_policy(&s.db, &t, &b, &c.sub, p).await?;
    audit(&s, &c, &b, "staff.approval_policy.created", &r.id).await;
    Ok(Json(ApiResponse::ok(r)))
}
async fn list_approvals(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<StatusQuery>,
) -> ApiResult<Vec<ApprovalRequestRecord>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_approvals(&s.db, &t, &b, q.status.as_deref().unwrap_or(""))
            .await?,
    )))
}
async fn create_approval(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<ApprovalRequestInput>,
) -> ApiResult<ApprovalRequestRecord> {
    mobile(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r = staff_enterprise_service::create_approval(&s.db, &t, &b, &c.sub, &c.role, p).await?;
    audit(&s, &c, &b, "staff.approval.requested", &r.id).await;
    Ok(Json(ApiResponse::ok(r)))
}
async fn get_approval(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ApprovalDetail> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::approval_detail(&s.db, &t, &b, &id).await?,
    )))
}
async fn decide_approval(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<DecisionRequest>,
) -> ApiResult<ApprovalRequestRecord> {
    mobile(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r =
        staff_enterprise_service::decide_approval(&s.db, &t, &b, &id, &c.sub, &c.role, p).await?;
    audit(&s, &c, &b, &format!("staff.approval.{}", r.status), &r.id).await;
    Ok(Json(ApiResponse::ok(r)))
}
async fn list_audit(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<AuditQuery>,
) -> ApiResult<Vec<AuditRecord>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_audit(
            &s.db,
            &t,
            &b,
            q.event_prefix.as_deref().unwrap_or("staff."),
        )
        .await?,
    )))
}
async fn self_dashboard(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SelfQuery>,
) -> ApiResult<SelfDashboardRecord> {
    mobile(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::self_dashboard(&s.db, &t, &b, &c.sub, q.date).await?,
    )))
}

async fn self_payslip(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> Result<Response<Body>, AppError> {
    mobile(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let pdf =
        staff_payroll_service::payslip_pdf(&state.db, &tenant_id, &branch_id, &run_id, &staff_id)
            .await?;
    Response::builder()
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"payslip-{run_id}-{staff_id}.pdf\""),
        )
        .body(Body::from(pdf))
        .map_err(|_| AppError::internal("failed to build payslip"))
}
async fn list_tips(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<PeriodQuery>,
) -> ApiResult<Vec<StaffTipRecord>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_tips(
            &s.db,
            &t,
            &b,
            q.staff_id.as_deref().unwrap_or(""),
            q.period_start,
            q.period_end,
        )
        .await?,
    )))
}
async fn tip_summary(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<Vec<StaffTipSummary>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::tip_summary(&s.db, &t, &b, q.period_start, q.period_end).await?,
    )))
}
async fn record_tip_payout(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<TipPayoutRequest>,
) -> ApiResult<serde_json::Value> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let id = staff_enterprise_service::record_tip_payout(&s.db, &t, &b, &c.sub, p).await?;
    audit(&s, &c, &b, "staff.tip_payout.recorded", &id).await;
    Ok(Json(ApiResponse::ok(json!({"id":id}))))
}
async fn list_rules(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Vec<StatutoryRuleRecord>> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_rules(&s.db, &t, &b).await?,
    )))
}
async fn create_rule(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<StatutoryRuleRequest>,
) -> ApiResult<StatutoryRuleRecord> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r = staff_enterprise_service::create_rule(&s.db, &t, &b, &c.sub, p).await?;
    audit(&s, &c, &b, "staff.statutory_rule.created", &r.id).await;
    Ok(Json(ApiResponse::ok(r)))
}
async fn calculate_statutory(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<StatutoryCalculationRequest>,
) -> ApiResult<StatutoryCalculationRecord> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r = staff_enterprise_service::calculate_statutory(&s.db, &t, &b, &c.sub, p).await?;
    audit(&s, &c, &b, "staff.statutory.calculated", &r.id).await;
    Ok(Json(ApiResponse::ok(r)))
}
async fn statutory_summary(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<StatutorySummary> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::statutory_summary(&s.db, &t, &b, q.period_start, q.period_end)
            .await?,
    )))
}
async fn compliance_export(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(q): Json<SummaryQuery>,
) -> ApiResult<ComplianceExport> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::compliance_export(&s.db, &t, &b, q.period_start, q.period_end)
            .await?,
    )))
}
async fn list_salary_revisions(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(staff): Path<String>,
) -> ApiResult<Vec<SalaryRevisionRecord>> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::salary_revisions(&s.db, &t, &b, &staff).await?,
    )))
}
async fn create_salary_revision(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(staff): Path<String>,
    Json(p): Json<SalaryRevisionRequest>,
) -> ApiResult<SalaryRevisionRecord> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r =
        staff_enterprise_service::create_salary_revision(&s.db, &t, &b, &staff, &c.sub, p).await?;
    audit(&s, &c, &b, "staff.salary_revision.requested", &r.id).await;
    Ok(Json(ApiResponse::ok(r)))
}
async fn decide_salary_revision(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<DecisionRequest>,
) -> ApiResult<SalaryRevisionRecord> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r = staff_enterprise_service::decide_salary_revision(&s.db, &t, &b, &id, &c.sub, p).await?;
    audit(
        &s,
        &c,
        &b,
        &format!("staff.salary_revision.{}", r.status),
        &r.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(r)))
}

async fn optimize_roster(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<RosterOptimizeRequest>,
) -> ApiResult<RosterDraftRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_enterprise_service::optimize_roster(&s.db, &t, &b, &c.sub, p).await?;
    audit(&s, &c, &b, "staff.roster.optimized", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn apply_roster(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<VersionRequest>,
) -> ApiResult<RosterDraftRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::publish_roster(&s.db, &t, &b, &id, &c.sub, p.version).await?;
    audit(&s, &c, &b, "staff.roster.published", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn roster_coverage(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<RosterCoverageResponse> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::roster_coverage(&s.db, &t, &b, q.period_start, q.period_end)
            .await?,
    )))
}

async fn manpower_forecast(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<ManpowerForecastResult> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::manpower_forecast(
            &s.db,
            &t,
            &b,
            None,
            q.period_start,
            q.period_end,
        )
        .await?,
    )))
}

async fn recalculate_manpower(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<RosterOptimizeRequest>,
) -> ApiResult<ManpowerForecastResult> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_enterprise_service::manpower_forecast(
        &s.db,
        &t,
        &b,
        Some(&c.sub),
        p.period_start,
        p.period_end,
    )
    .await?;
    audit(
        &s,
        &c,
        &b,
        "staff.manpower.recalculated",
        row.id.as_deref().unwrap_or(""),
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn recommend_replacement(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<ReplacementRequest>,
) -> ApiResult<ReplacementRecommendationResponse> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_enterprise_service::recommend_replacement(&s.db, &t, &b, &c.sub, p).await?;
    if let Some(saved) = &row.recommendation {
        audit(&s, &c, &b, "staff.replacement.recommended", &saved.id).await;
    }
    Ok(Json(ApiResponse::ok(row)))
}

async fn replacement_history(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Vec<ReplacementRecommendationRecord>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::replacement_history(&s.db, &t, &b).await?,
    )))
}

async fn decide_replacement(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<DecisionRequest>,
) -> ApiResult<ReplacementRecommendationRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_enterprise_service::decide_replacement(&s.db, &t, &b, &id, &c.sub, p).await?;
    audit(
        &s,
        &c,
        &b,
        &format!("staff.replacement.{}", row.status),
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn burnout_risk(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<Vec<IntelligenceRiskRow>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::intelligence_risks(
            &s.db,
            &t,
            &b,
            q.period_start,
            q.period_end,
            false,
        )
        .await?,
    )))
}

async fn retention_risk(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<Vec<IntelligenceRiskRow>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::intelligence_risks(
            &s.db,
            &t,
            &b,
            q.period_start,
            q.period_end,
            true,
        )
        .await?,
    )))
}

async fn best_staff(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<BestStaffRequest>,
) -> ApiResult<Vec<RankedStaffCandidate>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::best_staff(&s.db, &t, &b, p).await?,
    )))
}

async fn staff_sales_report(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SalesReportQuery>,
) -> ApiResult<StaffSalesReport> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::staff_sales_report(
            &s.db,
            &t,
            &b,
            q.period_start,
            q.period_end,
            q.page.unwrap_or(1),
            q.page_size.unwrap_or(50),
        )
        .await?,
    )))
}

async fn operational_report(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(report_type): Path<String>,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<serde_json::Value> {
    if matches!(report_type.as_str(), "payroll" | "commission") {
        payroll(&c)?;
    } else {
        read(&c)?;
    }
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::operational_report(
            &s.db,
            &t,
            &b,
            &report_type,
            q.period_start,
            q.period_end,
        )
        .await?,
    )))
}

async fn notification_preference(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(staff_id): Path<String>,
) -> ApiResult<Option<StaffNotificationPreferenceRecord>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::notification_preference(&s.db, &t, &b, &staff_id).await?,
    )))
}

async fn save_notification_preference(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(staff_id): Path<String>,
    Json(request): Json<NotificationPreferenceRequest>,
) -> ApiResult<StaffNotificationPreferenceRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::save_notification_preference(&s.db, &t, &b, &staff_id, request)
            .await?;
    audit(&s, &c, &b, "staff.notification.preference.saved", &staff_id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_notification_templates(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Vec<StaffNotificationTemplateRecord>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_notification_templates(&s.db, &t, &b).await?,
    )))
}

async fn create_notification_template(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(request): Json<NotificationTemplateRequest>,
) -> ApiResult<StaffNotificationTemplateRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::create_notification_template(&s.db, &t, &b, &c.sub, request)
            .await?;
    audit(&s, &c, &b, "staff.notification.template.created", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_notification_queue(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<NotificationQueueQuery>,
) -> ApiResult<Vec<StaffNotificationQueueRecord>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_notification_queue(&s.db, &t, &b, q.status.as_deref())
            .await?,
    )))
}

async fn queue_notification(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(request): Json<QueueNotificationRequest>,
) -> ApiResult<StaffNotificationQueueRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_enterprise_service::queue_notification(&s.db, &t, &b, &c.sub, request).await?;
    audit(&s, &c, &b, "staff.notification.queued", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve_notification(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<VersionRequest>,
) -> ApiResult<StaffNotificationQueueRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::approve_notification(&s.db, &t, &b, &id, request.version, &c.sub)
            .await?;
    audit(&s, &c, &b, "staff.notification.approved", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn record_notification_delivery(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<NotificationDeliveryRequest>,
) -> ApiResult<StaffNotificationQueueRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::record_notification_delivery(&s.db, &t, &b, &id, request).await?;
    audit(
        &s,
        &c,
        &b,
        &format!("staff.notification.{}", row.status),
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn retry_notification(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<VersionRequest>,
) -> ApiResult<StaffNotificationQueueRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::retry_notification(&s.db, &t, &b, &id, request.version).await?;
    audit(&s, &c, &b, "staff.notification.retry", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn notification_logs(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<NotificationLogQuery>,
) -> ApiResult<Vec<StaffNotificationDeliveryLogRecord>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::notification_delivery_logs(&s.db, &t, &b, q.queue_id.as_deref())
            .await?,
    )))
}

async fn enterprise_command_center(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<StaffEnterpriseCommandCenter> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::enterprise_command_center(
            &s.db,
            &t,
            &b,
            q.period_start,
            q.period_end,
        )
        .await?,
    )))
}

async fn staff_digital_twins(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<serde_json::Value> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::staff_digital_twins(&s.db, &t, &b, q.period_start, q.period_end)
            .await?,
    )))
}

async fn staff_digital_twin(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(staff_id): Path<String>,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<serde_json::Value> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::staff_digital_twin(
            &s.db,
            &t,
            &b,
            &staff_id,
            q.period_start,
            q.period_end,
        )
        .await?,
    )))
}

async fn staff_skill_matrix(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Vec<StaffSkillMatrixRecord>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::staff_skill_matrix(&s.db, &t, &b).await?,
    )))
}

async fn floor_control(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<FloorControlQuery>,
) -> ApiResult<Vec<StaffFloorControlRecord>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::floor_control(&s.db, &t, &b, q.date).await?,
    )))
}

async fn training_assignments(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<CoachingGoalQuery>,
) -> ApiResult<Vec<crate::repositories::staff_advanced_repository::StaffTaskRecord>> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::training_assignments(
            &s.db,
            &t,
            &b,
            q.staff_id.as_deref().unwrap_or(""),
            q.status.as_deref().unwrap_or(""),
        )
        .await?,
    )))
}

async fn assign_training(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(request): Json<TrainingAssignmentRequest>,
) -> ApiResult<crate::repositories::staff_advanced_repository::StaffTaskRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_enterprise_service::assign_training(&s.db, &t, &b, &c.sub, request).await?;
    audit(&s, &c, &b, "staff.training.assigned", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn coaching_insights(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<PeriodQuery>,
) -> ApiResult<serde_json::Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::coaching_insights(
            &s.db,
            &t,
            &b,
            q.period_start,
            q.period_end,
            q.staff_id.as_deref().unwrap_or(""),
        )
        .await?,
    )))
}

async fn list_coaching_goals(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<CoachingGoalQuery>,
) -> ApiResult<Vec<CoachingGoalRecord>> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_coaching_goals(
            &s.db,
            &t,
            &b,
            q.staff_id.as_deref().unwrap_or(""),
            q.status.as_deref().unwrap_or(""),
        )
        .await?,
    )))
}

async fn create_coaching_goal(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(request): Json<CoachingGoalRequest>,
) -> ApiResult<CoachingGoalRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::create_coaching_goal(&s.db, &t, &b, &c.sub, request).await?;
    audit(&s, &c, &b, "staff.coaching.goal.created", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn complete_coaching_action(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<VersionRequest>,
) -> ApiResult<CoachingActionRecord> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_enterprise_service::complete_coaching_action(&s.db, &t, &b, &id, request.version)
            .await?;
    audit(&s, &c, &b, "staff.coaching.action.completed", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

fn read(c: &AuthClaims) -> Result<(), AppError> {
    role(c, &["owner", "admin", "manager", "accountant"])
}
fn manager(c: &AuthClaims) -> Result<(), AppError> {
    role(c, &["owner", "admin", "manager"])
}
fn payroll(c: &AuthClaims) -> Result<(), AppError> {
    role(c, &["owner", "admin", "accountant"])
}
fn mobile(c: &AuthClaims) -> Result<(), AppError> {
    role(c, &["owner", "admin", "manager", "staff"])
}
fn role(c: &AuthClaims, roles: &[&str]) -> Result<(), AppError> {
    if roles.iter().any(|r| r.eq_ignore_ascii_case(&c.role)) {
        Ok(())
    } else {
        Err(AppError::forbidden("staff enterprise access is restricted"))
    }
}
async fn audit(s: &AppState, c: &AuthClaims, b: &str, event: &str, id: &str) {
    let _ = auth_repository::audit(
        &s.db,
        AuthAuditInput {
            tenant_id: &c.tenant_id,
            user_id: Some(&c.sub),
            session_id: (!c.session_id.is_empty()).then_some(c.session_id.as_str()),
            branch_id: Some(b),
            identity: None,
            event_type: event,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({"entityId":id}),
        },
    )
    .await;
}
