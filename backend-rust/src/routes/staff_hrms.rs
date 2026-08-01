use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::auth_repository::{self, AuthAuditInput},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        staff_hrms_service::{self, *},
    },
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff/hrms", get(dashboard))
        .route("/staff/hrms/job-openings", post(create_job_opening))
        .route("/staff/hrms/job-openings/:id", patch(update_job_opening))
        .route("/staff/hrms/applications", post(create_application))
        .route("/staff/hrms/applications/:id", patch(update_application))
        .route("/staff/hrms/lifecycle-cases", post(create_lifecycle_case))
        .route(
            "/staff/hrms/lifecycle-cases/:id/tasks/:task_id",
            patch(update_lifecycle_task),
        )
        .route(
            "/staff/hrms/lifecycle-cases/:id/settlement",
            patch(complete_settlement),
        )
        .route(
            "/staff/hrms/employees/:id/employment",
            patch(update_employment_status),
        )
        .route("/staff/hrms/appraisal-cycles", post(create_appraisal_cycle))
        .route("/staff/hrms/goal-templates", post(create_goal_template))
        .route(
            "/staff/hrms/appraisal-cycles/:id",
            patch(update_appraisal_cycle),
        )
        .route(
            "/staff/hrms/appraisal-cycles/:id/populate",
            post(populate_appraisal_cycle),
        )
        .route(
            "/staff/hrms/appraisal-reviews/:id/manager",
            patch(submit_manager_review),
        )
        .route(
            "/staff/hrms/appraisal-reviews/:id/calibrate",
            patch(calibrate_appraisal),
        )
        .route(
            "/staff/hrms/appraisal-reviews/:id/approve",
            patch(approve_appraisal),
        )
        .route("/staff-self/appraisals", get(self_appraisals))
        .route(
            "/staff-self/appraisals/:id/self-review",
            patch(submit_self_review),
        )
        .route(
            "/staff-self/appraisals/:id/acknowledge",
            patch(acknowledge_appraisal),
        )
        .route("/staff/hrms/succession-plans", post(create_succession_plan))
        .route(
            "/staff/hrms/promotion-readiness",
            get(promotion_readiness_report),
        )
        .route(
            "/staff/hrms/succession-plans/:id",
            patch(close_succession_plan),
        )
        .route(
            "/staff/hrms/succession-plans/:id/candidates",
            post(create_succession_candidate),
        )
        .route(
            "/staff/hrms/succession-candidates/:id",
            patch(update_succession_candidate),
        )
        .route(
            "/staff/hrms/succession-candidates/:id/decision",
            post(decide_succession_candidate),
        )
}

async fn dashboard(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Value> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_hrms_service::dashboard(&s.db, &t, &b).await?,
    )))
}
async fn create_job_opening(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<JobOpeningRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::create_job_opening(&s.db, &t, &b, &c.sub, p).await?;
    audited(&s, &c, &b, "staff.hrms.job_opening.created", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn update_job_opening(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<StatusRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::update_job_opening_status(&s.db, &t, &b, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.job_opening.updated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn create_application(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<ApplicationRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::create_application(&s.db, &t, &b, &c.sub, p).await?;
    audited(&s, &c, &b, "staff.hrms.application.created", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn update_application(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<ApplicationStageRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::update_application_stage(&s.db, &t, &b, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.application.updated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn create_lifecycle_case(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<LifecycleCaseRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::create_lifecycle_case(&s.db, &t, &b, &c.sub, p).await?;
    audited(&s, &c, &b, "staff.hrms.lifecycle.created", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn update_lifecycle_task(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path((id, task)): Path<(String, String)>,
    Json(p): Json<LifecycleTaskRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::update_lifecycle_task(&s.db, &t, &b, &id, &task, p).await?;
    audited(&s, &c, &b, "staff.hrms.lifecycle.task_updated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn complete_settlement(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<SettlementRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::complete_settlement(&s.db, &t, &b, &id, p).await?;
    audited(
        &s,
        &c,
        &b,
        "staff.hrms.lifecycle.settlement_completed",
        &row,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn update_employment_status(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<EmploymentStatusRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::update_employment_status(&s.db, &t, &b, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.employment.updated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn create_appraisal_cycle(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<AppraisalCycleRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::create_appraisal_cycle(&s.db, &t, &b, &c.sub, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal_cycle.created", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn update_appraisal_cycle(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<StatusRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::update_appraisal_cycle_status(&s.db, &t, &b, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal_cycle.updated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn create_goal_template(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<GoalTemplateRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::create_goal_template(&s.db, &t, &b, &c.sub, p).await?;
    audited(&s, &c, &b, "staff.hrms.goal_template.created", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn populate_appraisal_cycle(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<AppraisalPopulationRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::populate_appraisal_cycle(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal_cycle.populated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn submit_manager_review(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<ManagerReviewRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::submit_manager_review(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal.manager_submitted", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn calibrate_appraisal(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<CalibrationRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::calibrate_appraisal(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal.calibrated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn approve_appraisal(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<AppraisalDecisionRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::approve_appraisal(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal.approved", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn self_appraisals(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Vec<Value>> {
    self_access(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_hrms_service::self_appraisals(&s.db, &t, &b, &c.sub).await?,
    )))
}
async fn submit_self_review(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<SelfReviewRequest>,
) -> ApiResult<Value> {
    self_access(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::submit_self_review(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal.self_submitted", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn acknowledge_appraisal(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<AppraisalDecisionRequest>,
) -> ApiResult<Value> {
    self_access(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::acknowledge_appraisal(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.appraisal.acknowledged", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn create_succession_plan(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<SuccessionPlanRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::create_succession_plan(&s.db, &t, &b, &c.sub, p).await?;
    audited(&s, &c, &b, "staff.hrms.succession_plan.created", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn create_succession_candidate(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<SuccessionCandidateRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_hrms_service::create_succession_candidate(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.succession_candidate.created", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn close_succession_plan(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<SuccessionPlanCloseRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row = staff_hrms_service::close_succession_plan(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.succession_plan.closed", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}
async fn update_succession_candidate(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<SuccessionCandidateUpdateRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_hrms_service::update_succession_candidate(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.succession_candidate.updated", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn decide_succession_candidate(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<SuccessionDecisionRequest>,
) -> ApiResult<Value> {
    manage(&c)?;
    let (t, b) = tenant_branch(&h)?;
    let row =
        staff_hrms_service::decide_succession_candidate(&s.db, &t, &b, &c.sub, &id, p).await?;
    audited(&s, &c, &b, "staff.hrms.succession_candidate.decided", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn promotion_readiness_report(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
) -> ApiResult<Value> {
    read(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        staff_hrms_service::promotion_readiness_report(&s.db, &t, &b).await?,
    )))
}

fn read(c: &AuthClaims) -> Result<(), AppError> {
    if ["owner", "admin", "manager", "accountant"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&c.role))
        || c.permissions
            .iter()
            .any(|p| matches!(p.as_str(), "staff.read" | "staff.manage"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("HRMS access is restricted"))
    }
}
fn manage(c: &AuthClaims) -> Result<(), AppError> {
    if ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&c.role))
        || c.permissions.iter().any(|p| p == "staff.manage")
    {
        Ok(())
    } else {
        Err(AppError::forbidden("HRMS management access is restricted"))
    }
}
fn self_access(c: &AuthClaims) -> Result<(), AppError> {
    if c.role.eq_ignore_ascii_case("staff")
        || c.permissions.iter().any(|p| {
            matches!(
                p.as_str(),
                "staff.app.performance.read" | "staff.self_manage" | "staff_self.write"
            )
        })
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff appraisal access is restricted"))
    }
}
async fn audited(s: &AppState, c: &AuthClaims, branch: &str, event: &str, row: &Value) {
    let _ = auth_repository::audit(
        &s.db,
        AuthAuditInput {
            tenant_id: &c.tenant_id,
            user_id: Some(&c.sub),
            session_id: (!c.session_id.is_empty()).then_some(c.session_id.as_str()),
            branch_id: Some(branch),
            identity: None,
            event_type: event,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({"entityId":row.get("id").and_then(Value::as_str).unwrap_or(""),"staffId":row.get("staffId").and_then(Value::as_str),"applicationId":row.get("applicationId").and_then(Value::as_str),"status":row.get("status"),"settlementStatus":row.get("settlementStatus")}),
        },
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::{manage, read, self_access, AuthClaims};

    fn claims(role: &str, permissions: &[&str]) -> AuthClaims {
        AuthClaims {
            sub: "test".into(),
            tenant_id: "test".into(),
            branch_id: Some("test".into()),
            role: role.into(),
            role_id: None,
            permissions: permissions.iter().map(|value| value.to_string()).collect(),
            denied_permissions: Vec::new(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            session_id: String::new(),
            mfa_enrollment_required: false,
            token_type: "access".into(),
            jti: "test".into(),
            iat: 0,
            exp: usize::MAX,
        }
    }

    #[test]
    fn hrms_rbac_separates_management_from_read_only_access() {
        for role in ["owner", "admin", "manager"] {
            let claims = claims(role, &[]);
            assert!(read(&claims).is_ok());
            assert!(manage(&claims).is_ok());
        }
        let accountant = claims("accountant", &[]);
        assert!(read(&accountant).is_ok());
        assert!(manage(&accountant).is_err());
        let reader = claims("staff", &["staff.read"]);
        assert!(read(&reader).is_ok());
        assert!(manage(&reader).is_err());
        let denied = claims("staff", &[]);
        assert!(read(&denied).is_err());
        assert!(manage(&denied).is_err());
        assert!(self_access(&denied).is_ok());
        assert!(self_access(&claims("accountant", &[])).is_err());
    }
}
