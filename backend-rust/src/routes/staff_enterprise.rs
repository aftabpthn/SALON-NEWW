use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, Response},
    routing::{get, patch, post},
    Extension, Json, Router,
};
use chrono::{FixedOffset, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        inventory_repository,
        staff_enterprise_repository::*,
    },
    routes::context::tenant_branch,
    services::{
        auth_service::{self, AuthClaims},
        inventory_adjustment_service, staff_ai_service, staff_app_service,
        staff_enterprise_service::{
            self, ApprovalDetail, ApprovalPolicyRequest, ApprovalRequestInput, BestStaffRequest,
            CoachingGoalRequest, ComplianceExport, DecisionRequest, IntelligenceRiskRow,
            ManpowerForecastResult, NotificationDeliveryRequest, NotificationPreferenceRequest,
            NotificationTemplateRequest, QueueNotificationRequest, RankedStaffCandidate,
            ReplacementRecommendationResponse, ReplacementRequest, RosterCoverageResponse,
            RosterOptimizeRequest, SalaryRevisionRequest, StaffEnterpriseCommandCenter,
            StaffRuleAcknowledgementRequest, StaffRuleDocumentRequest, StaffRuleViolationRequest,
            StaffRuleViolationResolutionRequest, StaffSalesReport, StatutoryCalculationRequest,
            StatutoryRuleRequest, StatutorySummary, TipPayoutRequest, TrainingAssignmentRequest,
            VersionRequest,
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
        .route("/staff/feedback", get(list_staff_feedback))
        .route("/staff/feedback/:id", patch(resolve_staff_feedback))
        .route(
            "/staff/rules",
            get(list_staff_rules_center).post(create_staff_rule_document),
        )
        .route(
            "/staff/rules/:id/publish",
            post(publish_staff_rule_document),
        )
        .route(
            "/staff/rules/:id/unpublish",
            post(unpublish_staff_rule_document),
        )
        .route("/staff/rules/violations", post(create_staff_rule_violation))
        .route(
            "/staff/rules/violations/:id/resolve",
            post(resolve_staff_rule_violation),
        )
        .route("/staff/self/dashboard", get(self_dashboard))
        .route(
            "/staff-self/feedback",
            get(list_self_feedback).post(create_self_feedback),
        )
        .route("/staff-self/offers", get(list_self_offers))
        .route("/staff-self/rules", get(list_self_staff_rules))
        .route("/staff-self/rules/:id/read", post(mark_staff_rule_read))
        .route(
            "/staff-self/rules/:id/acknowledge",
            post(acknowledge_staff_rule),
        )
        .route(
            "/staff-self/offers/:id/creative",
            get(get_self_offer_creative),
        )
        .route("/staff-self/enterprise-os", get(staff_app_enterprise_os))
        .route("/staff-self/business", get(staff_app_business))
        .route(
            "/staff-self/business/product-usage",
            post(record_staff_product_usage),
        )
        .route(
            "/staff-self/appointments/:id/recommendations",
            get(self_appointment_recommendations),
        )
        .route(
            "/staff-self/business/invoices/:id",
            get(staff_app_business_invoice),
        )
        .route(
            "/staff-self/workspace-preferences",
            get(staff_app_workspace_preferences).put(save_staff_app_workspace_preferences),
        )
        .route("/staff/self/payslips/:run_id", get(self_payslip))
        .route("/staff/tips", get(list_tips))
        .route("/staff/tips/summary", get(tip_summary))
        .route("/staff/tips/payouts", post(record_tip_payout))
        .route(
            "/staff/payroll-compliance/rules",
            get(list_rules).post(create_rule),
        )
        .route(
            "/staff/payroll-compliance/rules/:id/decision",
            post(decide_rule),
        )
        .route(
            "/staff/payroll-compliance/calculate",
            post(calculate_statutory),
        )
        .route("/staff/payroll-compliance/summary", get(statutory_summary))
        .route("/staff/payroll-compliance/export", post(compliance_export))
        .route("/staff/salary-revisions", get(list_all_salary_revisions))
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
        .route("/staff/intelligence/ai-analysis", get(staff_ai_analysis))
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
#[serde(rename_all = "camelCase")]
struct StaffFeedbackQuery {
    status: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffSelfFeedbackRequest {
    category: String,
    title: String,
    body: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffFeedbackResolutionRequest {
    status: String,
    manager_note: String,
}
#[derive(Deserialize)]
struct SelfQuery {
    date: Option<NaiveDate>,
}
#[derive(Deserialize)]
struct StaffAppRangeQuery {
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    date: Option<NaiveDate>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffAppBusinessQuery {
    date: Option<NaiveDate>,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    page: Option<i64>,
    page_size: Option<i64>,
    q: Option<String>,
    status: Option<String>,
    sort: Option<String>,
    all_history: Option<bool>,
    service_id: Option<String>,
    service: Option<String>,
    department: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffProductUsageRequest {
    inventory_item_id: String,
    service_id: String,
    client_id: String,
    appointment_id: String,
    actual_quantity: i32,
    notes: Option<String>,
    idempotency_key: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SalaryRevisionQuery {
    staff_id: Option<String>,
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
async fn list_staff_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffFeedbackQuery>,
) -> ApiResult<serde_json::Value> {
    manager(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.as_deref().unwrap_or("").trim();
    let rows = sqlx::query_scalar::<_, serde_json::Value>(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
          'id',feedback.id,'staffId',feedback.staff_id,
          'staffName',COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name))),
          'category',feedback.category,'title',feedback.title,'body',feedback.body,
          'status',feedback.status,'managerNote',feedback.manager_note,
          'createdAt',feedback.created_at,'updatedAt',feedback.updated_at
        ) ORDER BY feedback.created_at DESC),'[]'::JSONB)
        FROM staff_self_feedback feedback
        LEFT JOIN staff ON staff.tenant_id=feedback.tenant_id AND staff.branch_id=feedback.branch_id AND staff.id=feedback.staff_id
        WHERE feedback.tenant_id=$1 AND feedback.branch_id=$2 AND ($3='' OR feedback.status=$3)"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(status)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load staff feedback"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn resolve_staff_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffFeedbackResolutionRequest>,
) -> ApiResult<serde_json::Value> {
    manager(&claims)?;
    let status = payload.status.trim().to_ascii_lowercase();
    if !matches!(
        status.as_str(),
        "open" | "in_review" | "resolved" | "closed"
    ) {
        return Err(AppError::validation("feedback status is invalid"));
    }
    let manager_note = payload.manager_note.trim();
    if manager_note.chars().count() > 2000
        || matches!(status.as_str(), "resolved" | "closed") && manager_note.is_empty()
    {
        return Err(AppError::validation(
            "manager note is required to resolve or close feedback",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = sqlx::query_scalar::<_, serde_json::Value>(
        r#"UPDATE staff_self_feedback SET status=$4,manager_note=$5,updated_at=NOW()
           WHERE id=$1 AND tenant_id=$2 AND branch_id=$3
           RETURNING JSONB_BUILD_OBJECT('id',id,'staffId',staff_id,'category',category,'title',title,
             'body',body,'status',status,'managerNote',manager_note,'createdAt',created_at,'updatedAt',updated_at)"#,
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&status)
    .bind(manager_note)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to update staff feedback"))?
    .ok_or_else(|| AppError::not_found("staff feedback not found"))?;
    audit(
        &state,
        &claims,
        &branch_id,
        &format!("staff.feedback.{status}"),
        &id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_staff_rules_center(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    governance(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_staff_rules_center(&state.db, &tenant_id, &branch_id)
            .await?,
    )))
}

async fn create_staff_rule_document(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<StaffRuleDocumentRequest>,
) -> ApiResult<StaffRuleDocumentRecord> {
    governance(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_enterprise_service::create_staff_rule_document(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        request,
    )
    .await?;
    audit(&state, &claims, &branch_id, "staff.rule.created", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn publish_staff_rule_document(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<VersionRequest>,
) -> ApiResult<StaffRuleDocumentRecord> {
    governance(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_enterprise_service::publish_staff_rule_document(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        request.version,
        &claims.sub,
    )
    .await?;
    audit(&state, &claims, &branch_id, "staff.rule.published", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn unpublish_staff_rule_document(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<VersionRequest>,
) -> ApiResult<StaffRuleDocumentRecord> {
    governance(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_enterprise_service::unpublish_staff_rule_document(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        request.version,
        &claims.sub,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.rule.unpublished",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_self_staff_rules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    require_app(&claims, "staff.app.rules.read", RULES_LEGACY_PERMISSIONS)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_self_staff_rules(
            &state.db, &tenant_id, &branch_id, &staff_id,
        )
        .await?,
    )))
}

async fn mark_staff_rule_read(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<StaffRuleStatusRecord> {
    require_app(&claims, "staff.app.rules.read", RULES_LEGACY_PERMISSIONS)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row = staff_enterprise_service::mark_staff_rule_read(
        &state.db, &tenant_id, &branch_id, &id, &staff_id,
    )
    .await?;
    audit(&state, &claims, &branch_id, "staff.rule.read", &id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn acknowledge_staff_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<StaffRuleAcknowledgementRequest>,
) -> ApiResult<StaffRuleStatusRecord> {
    require_app(&claims, "staff.app.rules.read", RULES_LEGACY_PERMISSIONS)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row = staff_enterprise_service::acknowledge_staff_rule(
        &state.db, &tenant_id, &branch_id, &id, &staff_id, request,
    )
    .await?;
    let event = if row.acknowledged_at.is_some() {
        "staff.rule.acknowledged"
    } else {
        "staff.rule.quiz_failed"
    };
    audit(&state, &claims, &branch_id, event, &id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn create_staff_rule_violation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<StaffRuleViolationRequest>,
) -> ApiResult<StaffRuleViolationRecord> {
    governance(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_enterprise_service::create_staff_rule_violation(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        request,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.rule.violation_recorded",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn resolve_staff_rule_violation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<StaffRuleViolationResolutionRequest>,
) -> ApiResult<StaffRuleViolationRecord> {
    governance(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_enterprise_service::resolve_staff_rule_violation(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        request,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.rule.violation_resolved",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_self_offers(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    require_app(
        &claims,
        "staff.app.offers.read",
        &["marketing.read", "appointments.read"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_scalar::<_, serde_json::Value>(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
          'id',id,'code',code,'title',COALESCE(NULLIF(title,''),code),
          'customerDescription',customer_description,'staffInstructions',staff_instructions,
          'benefitType',marketing_benefit_type,'benefitValue',benefit_value,
          'targetServiceIds',target_service_ids,'targetPackageIds',target_package_ids,
          'applicableServices',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',service.id,'name',service.name) ORDER BY service.name)
            FROM services service WHERE service.tenant_id=pos_coupons.tenant_id AND service.branch_id=pos_coupons.branch_id
              AND service.active=TRUE AND service.id=ANY(pos_coupons.target_service_ids)),'[]'::JSONB),
          'applicablePackages',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',package.id,'name',package.name) ORDER BY package.name)
            FROM packages package WHERE package.tenant_id=pos_coupons.tenant_id AND package.branch_id=pos_coupons.branch_id
              AND package.active=TRUE AND package.id=ANY(pos_coupons.target_package_ids)),'[]'::JSONB),
          'startsAt',starts_at,'endsAt',ends_at,
          'minimumBillPaise',min_subtotal_paise,'usageLimit',usage_limit,'usedCount',used_count,
          'perClientLimit',per_client_limit,'active',active,'approvalStatus',approval_status,
          'personalOffer',target_client_id IS NOT NULL,
          'hasCreative',EXISTS(SELECT 1 FROM marketing_offer_creatives creative WHERE creative.tenant_id=pos_coupons.tenant_id AND creative.branch_id=pos_coupons.branch_id AND creative.offer_id=pos_coupons.id)
        ) ORDER BY COALESCE(ends_at,starts_at,created_at) ASC),'[]'::JSONB)
        FROM pos_coupons
        WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND approval_status='approved' AND show_in_staff_app=TRUE
          AND (usage_limit IS NULL OR used_count<usage_limit)
          AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load staff offers"))?;
    let offer_ids = rows
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|offer| offer.get("id").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>();
    if !offer_ids.is_empty() {
        if let Err(error) = sqlx::query("INSERT INTO marketing_offer_events(tenant_id,branch_id,offer_id,event_type,channel) SELECT $1,$2,id,'view','staff_app' FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)")
            .bind(&tenant_id).bind(&branch_id).bind(&offer_ids).execute(&state.db).await
        {
            tracing::warn!(%error, "failed to track staff offer views");
        }
    }
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_self_offer_creative(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    require_app(
        &claims,
        "staff.app.offers.read",
        &["marketing.read", "appointments.read"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = sqlx::query_as::<_, (String, Vec<u8>)>(
        r#"SELECT creative.content_type,creative.content_bytes
           FROM marketing_offer_creatives creative
           JOIN pos_coupons offer ON offer.id=creative.offer_id AND offer.tenant_id=creative.tenant_id AND offer.branch_id=creative.branch_id
          WHERE creative.tenant_id=$1 AND creative.branch_id=$2 AND creative.offer_id=$3
            AND offer.active=TRUE AND offer.approval_status='approved' AND offer.show_in_staff_app=TRUE
            AND (offer.usage_limit IS NULL OR offer.used_count<offer.usage_limit)
            AND (offer.starts_at IS NULL OR offer.starts_at<=NOW()) AND (offer.ends_at IS NULL OR offer.ends_at>=NOW())"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(id.trim())
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load staff offer creative"))?
    .ok_or_else(|| AppError::not_found("offer creative was not found"))?;
    Response::builder()
        .header(header::CONTENT_TYPE, row.0)
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(row.1))
        .map_err(|_| AppError::internal("failed to stream offer creative"))
}

async fn list_self_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    require_app(
        &claims,
        "staff.app.feedback.read",
        &["staff.self_manage", "staff_self.write"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let rows = sqlx::query_scalar::<_, serde_json::Value>(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
          'id',id,'category',category,'title',title,'body',body,'status',status,
          'managerNote',manager_note,'createdAt',created_at,'updatedAt',updated_at
        ) ORDER BY created_at DESC),'[]'::JSONB)
        FROM staff_self_feedback WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load staff feedback"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_self_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<StaffSelfFeedbackRequest>,
) -> ApiResult<serde_json::Value> {
    require_app(
        &claims,
        "staff.app.feedback.manage",
        &["staff.self_manage", "staff_self.write"],
    )?;
    let category = payload.category.trim().to_ascii_lowercase();
    if !matches!(
        category.as_str(),
        "opinion" | "suggestion" | "training" | "complaint" | "difficulty"
    ) {
        return Err(AppError::validation("feedback category is invalid"));
    }
    let title = payload.title.trim();
    let body = payload.body.trim();
    if title.is_empty()
        || body.is_empty()
        || title.chars().count() > 160
        || body.chars().count() > 2000
    {
        return Err(AppError::validation("feedback title or message is invalid"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let id = uuid::Uuid::new_v4().to_string();
    let row = sqlx::query_scalar::<_, serde_json::Value>(
        r#"INSERT INTO staff_self_feedback(id,tenant_id,branch_id,staff_id,category,title,body)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           RETURNING JSONB_BUILD_OBJECT('id',id,'category',category,'title',title,'body',body,'status',status,'managerNote',manager_note,'createdAt',created_at,'updatedAt',updated_at)"#,
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .bind(&category)
    .bind(title)
    .bind(body)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to save staff feedback"))?;
    audit(&state, &claims, &branch_id, "staff.feedback.created", &id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn staff_app_workspace_preferences(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    require_app(
        &claims,
        "staff.app.settings.read",
        &[
            "staff.app.settings.manage",
            "staff.self_manage",
            "staff_self.write",
        ],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_app_service::workspace_preferences(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?,
    )))
}

async fn save_staff_app_workspace_preferences(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<staff_app_service::WorkspacePreferenceRequest>,
) -> ApiResult<serde_json::Value> {
    require_app(
        &claims,
        "staff.app.settings.manage",
        &["staff.self_manage", "staff_self.write"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_app_service::save_workspace_preferences(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}

async fn staff_app_enterprise_os(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffAppRangeQuery>,
) -> ApiResult<serde_json::Value> {
    let allowed = app_allowed(
        &claims,
        "staff.app.dashboard.read",
        &["staff.self_manage", "staff_self.write"],
    ) || app_allowed(
        &claims,
        "staff.app.appointments.read",
        &["appointments.read", "staff.self_manage"],
    ) || app_allowed(
        &claims,
        "staff.app.business.read",
        &["appointments.read", "staff.self_manage"],
    ) || app_allowed(
        &claims,
        "staff.app.tasks.read",
        &["staff.self_manage", "staff_self.write"],
    ) || app_allowed(
        &claims,
        "staff.app.calendar.read",
        &["staff.schedule.read", "staff.self_manage"],
    ) || app_allowed(
        &claims,
        "staff.app.roster.read",
        &["staff.schedule.read", "staff.self_manage"],
    ) || app_allowed(
        &claims,
        "staff.app.notifications.read",
        &["notifications.read", "staff.self_manage"],
    ) || app_allowed(
        &claims,
        "staff.app.performance.read",
        &["staff.analytics.read", "staff.self_manage"],
    ) || app_allowed(
        &claims,
        "staff.app.leaderboard.read",
        &["staff.analytics.read", "staff.self_manage"],
    ) || app_allowed(
        &claims,
        "staff.app.reports.read",
        &["reports.read", "staff.self_manage"],
    );
    if !allowed {
        return Err(AppError::forbidden("Staff App permission is required"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("India offset is valid"))
        .date_naive();
    let from = query.from.or(query.date).unwrap_or(today);
    let to = query.to.or(query.date).unwrap_or(from);
    let mut os =
        staff_app_service::enterprise_os(&state.db, &tenant_id, &branch_id, &claims.sub, from, to)
            .await?;
    filter_staff_app_os(&mut os, &claims);
    Ok(Json(ApiResponse::ok(os)))
}

async fn staff_app_business(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffAppBusinessQuery>,
) -> ApiResult<serde_json::Value> {
    if !app_allowed(
        &claims,
        "staff.app.business.read",
        &["appointments.read", "staff.self_manage"],
    ) && !app_allowed(
        &claims,
        "staff.app.reports.read",
        &["reports.read", "staff.self_manage"],
    ) {
        return Err(AppError::forbidden(
            "Staff App business or reports permission is required",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("India offset is valid"))
        .date_naive();
    let from = query.from.or(query.date).unwrap_or(today);
    let to = query.to.or(query.date).unwrap_or(from);
    let visible = staff_app_service::StaffBusinessVisibility {
        client_name: app_allowed(&claims, "staff.app.business.client_name.read", &[]),
        invoice_number: app_allowed(&claims, "staff.app.business.invoice_number.read", &[]),
        discount: app_allowed(&claims, "staff.app.business.discount.read", &[]),
        tax: app_allowed(&claims, "staff.app.business.tax.read", &[]),
        service_amount: app_allowed(&claims, "staff.app.business.service_amount.read", &[]),
        commission: app_allowed(
            &claims,
            "staff.app.business.commission.read",
            &["read:payroll"],
        ),
    };
    let earnings_visible = app_allowed(
        &claims,
        "staff.app.payroll.read",
        &["staff.payroll.read", "read:payroll"],
    );
    Ok(Json(ApiResponse::ok(
        staff_app_service::business(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            from,
            to,
            query.page.unwrap_or(1),
            query.page_size.unwrap_or(25),
            query.q.as_deref().unwrap_or(""),
            query.status.as_deref().unwrap_or(""),
            query.sort.as_deref().unwrap_or("desc"),
            query.all_history.unwrap_or(false),
            query.service_id.as_deref().unwrap_or(""),
            query.service.as_deref().unwrap_or(""),
            query.department.as_deref().unwrap_or(""),
            visible,
            earnings_visible,
        )
        .await?,
    )))
}

async fn record_staff_product_usage(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<StaffProductUsageRequest>,
) -> ApiResult<inventory_repository::BackbarUsageRecord> {
    require_app(&claims, "staff.self_manage", &["staff_self.write"])?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row = inventory_adjustment_service::record_backbar_usage(
        &state,
        inventory_adjustment_service::BackbarUsageInput {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            inventory_item_id: payload.inventory_item_id.trim(),
            service_id: Some(payload.service_id.trim()),
            staff_id: Some(&staff_id),
            client_id: Some(payload.client_id.trim()),
            appointment_id: Some(payload.appointment_id.trim()),
            actual_quantity: payload.actual_quantity,
            notes: payload.notes.as_deref().unwrap_or_default(),
            actor_user_id: &claims.sub,
            idempotency_key: payload.idempotency_key.trim(),
        },
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.product_usage.created",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn staff_app_business_invoice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(invoice_id): Path<String>,
) -> ApiResult<serde_json::Value> {
    let visible = staff_app_service::StaffBusinessVisibility {
        client_name: app_allowed(&claims, "staff.app.business.client_name.read", &[]),
        invoice_number: app_allowed(&claims, "staff.app.business.invoice_number.read", &[]),
        discount: app_allowed(&claims, "staff.app.business.discount.read", &[]),
        tax: app_allowed(&claims, "staff.app.business.tax.read", &[]),
        service_amount: app_allowed(&claims, "staff.app.business.service_amount.read", &[]),
        commission: app_allowed(
            &claims,
            "staff.app.business.commission.read",
            &["read:payroll"],
        ),
    };
    if !visible.invoice_detail() {
        return Err(AppError::forbidden("invoice permission is required"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_app_service::business_invoice(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &invoice_id,
            visible,
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
    let allowed = app_allowed(
        &c,
        "staff.app.dashboard.read",
        &["staff.self_manage", "staff_self.write"],
    ) || app_allowed(
        &c,
        "staff.app.appointments.read",
        &["appointments.read", "staff.self_manage"],
    ) || app_allowed(&c, "staff.app.profile.read", &["staff.self_manage"])
        || app_allowed(&c, "staff.app.settings.read", &["staff.self_manage"])
        || auth_service::staff_app_permission_allowed(
            &c,
            "staff.app.payroll.read",
            STAFF_APP_PAYROLL_ROLES,
            &["staff.payroll.read", "staff.payroll.manage", "finance.read"],
        );
    if !allowed {
        return Err(AppError::forbidden("Staff App permission is required"));
    }
    let (t, b) = tenant_branch(&h)?;
    let mut dashboard =
        staff_enterprise_service::self_dashboard(&s.db, &t, &b, &c.sub, q.date).await?;
    filter_self_dashboard(&mut dashboard, &c);
    Ok(Json(ApiResponse::ok(dashboard)))
}

const STAFF_APP_ROLES: &[&str] = &["owner", "admin", "manager", "staff"];
const STAFF_APP_PAYROLL_ROLES: &[&str] = &["owner", "admin", "accountant"];
const RULES_LEGACY_PERMISSIONS: &[&str] = &["staff.self_manage", "staff_self.write", "read:staff"];

fn app_allowed(c: &AuthClaims, permission: &str, legacy: &[&str]) -> bool {
    auth_service::staff_app_permission_allowed(c, permission, STAFF_APP_ROLES, legacy)
}

#[cfg(test)]
mod tests {
    use super::RULES_LEGACY_PERMISSIONS;

    #[test]
    fn rules_legacy_permissions_do_not_include_granular_task_access() {
        assert!(!RULES_LEGACY_PERMISSIONS.contains(&"staff.app.tasks.read"));
    }
}

fn require_app(c: &AuthClaims, permission: &str, legacy: &[&str]) -> Result<(), AppError> {
    if app_allowed(c, permission, legacy) {
        Ok(())
    } else {
        Err(AppError::forbidden("Staff App permission is required"))
    }
}

fn filter_staff_app_os(os: &mut serde_json::Value, c: &AuthClaims) {
    if !app_allowed(
        c,
        "staff.app.appointments.read",
        &["appointments.read", "staff.self_manage"],
    ) {
        os["timeline"] = json!([]);
        os["serviceTimers"] = json!([]);
        os["home"]["todayAppointments"] = json!(0);
    }
    if !app_allowed(
        c,
        "staff.app.business.read",
        &["appointments.read", "staff.self_manage"],
    ) {
        os["home"]["expectedRevenue"] = json!(0);
        os["home"]["pendingPayments"] = json!(0);
    }
    if !app_allowed(
        c,
        "staff.app.tasks.read",
        &["staff.self_manage", "staff_self.write"],
    ) {
        os["tasks"] = json!([]);
        os["home"]["tasks"] = json!(0);
    }
    let calendar = app_allowed(
        c,
        "staff.app.calendar.read",
        &["staff.schedule.read", "staff.self_manage"],
    );
    let roster = app_allowed(
        c,
        "staff.app.roster.read",
        &["staff.schedule.read", "staff.self_manage"],
    );
    if !calendar && !roster {
        os["calendar"] = json!([]);
    }
    if !app_allowed(
        c,
        "staff.app.notifications.read",
        &["notifications.read", "staff.self_manage"],
    ) {
        os["notifications"] = json!([]);
        os["home"]["recentNotifications"] = json!(0);
    }
    if !app_allowed(
        c,
        "staff.app.performance.read",
        &["staff.analytics.read", "staff.self_manage"],
    ) {
        os["performance"] = json!({});
    }
    if !app_allowed(
        c,
        "staff.app.business.service_amount.read",
        &[
            "read:finance",
            "read:sales",
            "read:payments",
            "read:invoices",
        ],
    ) {
        if os["performance"].is_object() {
            os["performance"]["revenue"] = json!(null);
            os["performance"]["targetRevenuePaise"] = json!(null);
            os["performance"]["revenueTargetPercent"] = json!(null);
            if let Some(opportunities) = os["performance"]["revenueOpportunities"].as_array_mut() {
                for opportunity in opportunities {
                    opportunity["projectedImpactPaise"] = json!(null);
                    opportunity["actualImpactPaise"] = json!(null);
                }
            }
            os["performance"]["equipmentIntelligence"]["summary"]["estimatedRevenuePaise"] =
                json!(null);
            if let Some(departments) =
                os["performance"]["equipmentIntelligence"]["departments"].as_array_mut()
            {
                for department in departments {
                    department["estimatedRevenuePaise"] = json!(null);
                }
            }
            if let Some(recommendations) =
                os["performance"]["equipmentIntelligence"]["recommendations"].as_array_mut()
            {
                for recommendation in recommendations {
                    recommendation["estimatedRevenuePaise"] = json!(null);
                }
            }
        }
        if let Some(reports) = os["reports"].as_object_mut() {
            for report in reports.values_mut() {
                report["revenue"] = json!(null);
            }
        }
        if let Some(leaderboard) = os["leaderboard"].as_array_mut() {
            for row in leaderboard {
                row["revenue"] = json!(null);
            }
        }
    }
    if !app_allowed(
        c,
        "staff.app.leaderboard.read",
        &["staff.analytics.read", "staff.self_manage"],
    ) {
        os["leaderboard"] = json!([]);
        os["gamification"] = json!({});
    }
    if !app_allowed(
        c,
        "staff.app.reports.read",
        &["reports.read", "staff.self_manage"],
    ) {
        os["reports"] = json!({});
    }
}

fn filter_self_dashboard(dashboard: &mut SelfDashboardRecord, c: &AuthClaims) {
    let calendar = app_allowed(
        c,
        "staff.app.calendar.read",
        &["staff.schedule.read", "staff.self_manage"],
    );
    let roster = app_allowed(
        c,
        "staff.app.roster.read",
        &["staff.schedule.read", "staff.self_manage"],
    );
    if !calendar && !roster {
        dashboard.schedule = None;
    }
    if !app_allowed(
        c,
        "staff.app.attendance.read",
        &[
            "staff.app.attendance.manage",
            "staff.attendance.read",
            "staff.self_manage",
        ],
    ) {
        dashboard.attendance = None;
    }
    if !app_allowed(
        c,
        "staff.app.tasks.read",
        &["staff.self_manage", "staff_self.write"],
    ) {
        dashboard.tasks = json!([]);
    }
    if !app_allowed(
        c,
        "staff.app.appointments.read",
        &["appointments.read", "staff.self_manage"],
    ) {
        dashboard.appointments = json!([]);
    }
    if !app_allowed(
        c,
        "staff.app.business.service_amount.read",
        &[
            "read:finance",
            "read:sales",
            "read:payments",
            "read:invoices",
        ],
    ) {
        dashboard.sales = json!([]);
    }
    if !app_allowed(
        c,
        "staff.app.leaves.read",
        &["staff.leave.read", "staff.self_manage"],
    ) {
        dashboard.leave_requests = json!([]);
    }
    if !calendar {
        dashboard.holidays = json!([]);
    }
    if !auth_service::staff_app_permission_allowed(
        c,
        "staff.app.payroll.read",
        STAFF_APP_PAYROLL_ROLES,
        &["staff.payroll.read", "staff.payroll.manage", "finance.read"],
    ) {
        dashboard.payroll_profile = json!({});
        dashboard.payroll = json!([]);
    }
    dashboard.payroll_rules = json!([]);
}

async fn self_payslip(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> Result<Response<Body>, AppError> {
    if !auth_service::staff_app_permission_allowed(
        &claims,
        "staff.app.payroll.read",
        STAFF_APP_PAYROLL_ROLES,
        &["staff.payroll.read", "staff.payroll.manage", "finance.read"],
    ) {
        return Err(AppError::forbidden(
            "Staff App payroll permission is required",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let pdf = staff_payroll_service::payslip_pdf(
        &state.db, &tenant_id, &branch_id, &run_id, &staff_id, true,
    )
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
    payroll_read(&c)?;
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
async fn decide_rule(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<DecisionRequest>,
) -> ApiResult<StatutoryRuleRecord> {
    payroll(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let r = staff_enterprise_service::decide_rule(&s.db, &t, &b, &c.sub, &id, p).await?;
    audit(&s, &c, &b, "staff.statutory_rule.decided", &r.id).await;
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
    payroll_read(&c)?;
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
    payroll_read(&c)?;
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
    payroll_read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::salary_revisions(&s.db, &t, &b, &staff).await?,
    )))
}
async fn list_all_salary_revisions(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SalaryRevisionQuery>,
) -> ApiResult<Vec<SalaryRevisionRecord>> {
    payroll_read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::salary_revisions(
            &s.db,
            &t,
            &b,
            q.staff_id.as_deref().unwrap_or("").trim(),
        )
        .await?,
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

async fn staff_ai_analysis(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Query(q): Query<SummaryQuery>,
) -> ApiResult<serde_json::Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_ai_service::analyze(&s, &t, &b, q.period_start, q.period_end).await?,
    )))
}

async fn best_staff(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<BestStaffRequest>,
) -> ApiResult<Vec<RankedStaffCandidate>> {
    if !auth_service::staff_app_permission_allowed(
        &c,
        "appointments.read",
        &["owner", "admin", "manager", "receptionist"],
        &["read:appointments"],
    ) {
        return Err(AppError::forbidden(
            "appointment read permission is required",
        ));
    }
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::best_staff(&s.db, &t, &b, p).await?,
    )))
}

async fn self_appointment_recommendations(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<RankedStaffCandidate>> {
    require_app(
        &c,
        "staff.app.appointments.read",
        &["appointments.read", "staff.self_manage"],
    )?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::best_staff_for_self_appointment(&s.db, &t, &b, &c.sub, &id)
            .await?,
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
fn governance(c: &AuthClaims, manage: bool) -> Result<(), AppError> {
    let permissions = if manage {
        &["staff.governance.manage", "staff.manage"][..]
    } else {
        &[
            "staff.governance.read",
            "staff.governance.manage",
            "staff.read",
            "staff.manage",
        ][..]
    };
    let denied = c.denied_permissions.iter().any(|denied| {
        permissions
            .iter()
            .any(|permission| denied.as_str() == *permission)
    });
    if !denied
        && (["owner", "admin", "manager"]
            .iter()
            .any(|role| role.eq_ignore_ascii_case(&c.role))
            || c.permissions.iter().any(|allowed| {
                permissions
                    .iter()
                    .any(|permission| allowed.as_str() == *permission)
            }))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff governance access is restricted"))
    }
}
fn payroll(c: &AuthClaims) -> Result<(), AppError> {
    payroll_permission(c, &["staff.payroll.manage"])
}
fn payroll_read(c: &AuthClaims) -> Result<(), AppError> {
    payroll_permission(c, &["staff.payroll.read", "staff.payroll.manage"])
}
fn payroll_permission(c: &AuthClaims, permissions: &[&str]) -> Result<(), AppError> {
    let denied = c.denied_permissions.iter().any(|denied| {
        permissions
            .iter()
            .any(|permission| denied.as_str() == *permission)
    });
    if !denied
        && (["owner", "admin", "accountant"]
            .iter()
            .any(|r| r.eq_ignore_ascii_case(&c.role))
            || c.permissions.iter().any(|allowed| {
                permissions
                    .iter()
                    .any(|permission| allowed.as_str() == *permission)
            }))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff enterprise access is restricted"))
    }
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
