use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, Response},
    routing::{delete, get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, security_service, staff_payroll_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff-payroll/preview", get(preview))
        .route(
            "/staff-payroll/commissions/calculate",
            post(calculate_commissions),
        )
        .route("/staff-payroll/runs", get(list_runs).post(run_payroll))
        .route(
            "/staff-payroll/runs/:run_id",
            get(get_run).put(save_adjustments),
        )
        .route("/staff-payroll/runs/:run_id/review", post(review))
        .route("/staff-payroll/runs/:run_id/finalize", post(finalize))
        .route("/staff-payroll/runs/:run_id/mark-paid", post(mark_paid))
        .route("/staff-payroll/runs/:run_id/payout", post(record_payout))
        .route(
            "/staff-payroll/holidays",
            get(list_holidays).post(save_holiday),
        )
        .route("/staff-payroll/holidays/:id", delete(delete_holiday))
        .route("/staff-payroll/runs/:run_id/export", get(export_run))
        .route(
            "/staff-payroll/runs/:run_id/payslips/:staff_id",
            get(download_payslip),
        )
        .route(
            "/staff-payroll/statutory-profiles",
            get(list_statutory_profiles),
        )
        .route(
            "/staff-payroll/statutory-profiles/:staff_id",
            get(get_statutory_profile).put(save_statutory_profile),
        )
        .route(
            "/staff-payroll/periods",
            get(list_payroll_periods).put(set_payroll_period_schedule),
        )
        .route("/staff-payroll/periods/lock", post(lock_payroll_period))
        .route(
            "/staff-payroll/periods/:period_month/reopen",
            post(reopen_payroll_period),
        )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct PeriodQuery {
    cycle: Option<String>,
    year: i32,
    month: u32,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct RunPayrollRequest {
    cycle: Option<String>,
    year: i32,
    month: u32,
    staff_id: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct SaveAdjustmentsRequest {
    entries: Vec<SaveAdjustmentEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct SaveAdjustmentEntry {
    staff_id: String,
    adjustment_paise: i64,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct PayoutRequest {
    payment_method: String,
    reference: Option<String>,
    idempotency_key: String,
    mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct MfaActionRequest {
    mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct HolidayQuery {
    from: NaiveDate,
    to: NaiveDate,
}

async fn preview(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<PeriodQuery>,
) -> ApiResult<staff_payroll_service::PayrollPreview> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    validate_cycle(query.cycle.as_deref())?;
    let result = staff_payroll_service::preview(
        &state.db,
        &tenant_id,
        &branch_id,
        query.year,
        query.month,
        query.staff_id.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn calculate_commissions(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<PeriodQuery>,
) -> ApiResult<staff_payroll_service::PayrollPreview> {
    preview(State(state), Extension(claims), headers, Query(query)).await
}

async fn list_runs(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::staff_payroll_repository::PayrollRunRecord>> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    let rows = staff_payroll_service::list_runs(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn run_payroll(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<RunPayrollRequest>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    validate_cycle(payload.cycle.as_deref())?;
    let staff_id = payload.staff_id.as_deref().unwrap_or("").trim();
    let reason = payload.reason.as_deref().unwrap_or("").trim();
    if !staff_id.is_empty() && reason.is_empty() {
        return Err(AppError::validation(
            "a regeneration reason is required when regenerating selected staff",
        ));
    }
    let result = staff_payroll_service::run_payroll(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload.year,
        payload.month,
        staff_id,
        reason,
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn get_run(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    let result = staff_payroll_service::detail(&state.db, &tenant_id, &branch_id, &run_id).await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn save_adjustments(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
    Json(payload): Json<SaveAdjustmentsRequest>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    let entries = payload
        .entries
        .into_iter()
        .map(|entry| staff_payroll_service::PayrollAdjustment {
            staff_id: entry.staff_id,
            adjustment_paise: entry.adjustment_paise,
            notes: entry.notes.unwrap_or_default(),
        })
        .collect();
    let result = staff_payroll_service::save_adjustments(
        &state.db,
        &tenant_id,
        &branch_id,
        &run_id,
        &claims.sub,
        entries,
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn review(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    let result =
        staff_payroll_service::review(&state.db, &tenant_id, &branch_id, &run_id, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn finalize(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
    Json(payload): Json<MfaActionRequest>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    require_payroll_action_mfa(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.mfa_code.as_deref(),
        "payroll.finalize",
    )
    .await?;
    let result =
        staff_payroll_service::finalize(&state.db, &tenant_id, &branch_id, &run_id, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn mark_paid(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
    Json(payload): Json<MfaActionRequest>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    require_payroll_action_mfa(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.mfa_code.as_deref(),
        "payroll.mark_paid",
    )
    .await?;
    let result =
        staff_payroll_service::mark_paid(&state.db, &tenant_id, &branch_id, &run_id, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn record_payout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
    Json(payload): Json<PayoutRequest>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    require_payroll_action_mfa(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.mfa_code.as_deref(),
        "payroll.payout",
    )
    .await?;
    let result = staff_payroll_service::record_payout(
        &state.settings,
        &state.db,
        &tenant_id,
        &branch_id,
        &run_id,
        &claims.sub,
        staff_payroll_service::PayrollPayoutInput {
            payment_method: payload.payment_method,
            reference: payload.reference.unwrap_or_default(),
            idempotency_key: payload.idempotency_key,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_holidays(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<HolidayQuery>,
) -> ApiResult<Vec<crate::repositories::staff_payroll_repository::StaffHolidayRecord>> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    Ok(Json(ApiResponse::ok(
        staff_payroll_service::list_holidays(
            &state.db, &tenant_id, &branch_id, query.from, query.to,
        )
        .await?,
    )))
}

async fn save_holiday(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<staff_payroll_service::StaffHolidayInput>,
) -> ApiResult<crate::repositories::staff_payroll_repository::StaffHolidayRecord> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    Ok(Json(ApiResponse::ok(
        staff_payroll_service::save_holiday(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}

async fn delete_holiday(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<()> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    staff_payroll_service::delete_holiday(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(())))
}

async fn require_payroll_action_mfa(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    code: Option<&str>,
    action: &str,
) -> Result<(), AppError> {
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        tenant_id,
        branch_id,
        &claims.sub,
        &claims.session_id,
        code,
        action,
    )
    .await
}

async fn export_run(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    let detail = staff_payroll_service::detail(&state.db, &tenant_id, &branch_id, &run_id).await?;
    let mut csv = String::from("Employee,Code,Attendance days,Worked minutes,Overtime minutes,Earned salary,Overtime pay,Commission,Adjustment,Deductions,Net pay,Status\r\n");
    for item in detail.items {
        let attendance_days =
            f64::from(item.attendance_days_x2 + item.paid_leave_days_x2 + item.weekly_off_days_x2)
                / 2.0;
        csv.push_str(
            &[
                csv_cell(&item.staff_name),
                csv_cell(item.employee_code.as_deref().unwrap_or("")),
                attendance_days.to_string(),
                item.worked_minutes.to_string(),
                item.overtime_minutes.to_string(),
                staff_payroll_service::paise_text(item.earned_salary_paise),
                staff_payroll_service::paise_text(item.overtime_paise),
                staff_payroll_service::paise_text(item.commission_paise),
                staff_payroll_service::paise_text(item.adjustment_paise),
                staff_payroll_service::paise_text(item.deductions_paise),
                staff_payroll_service::paise_text(item.net_paise),
                csv_cell(&item.status),
            ]
            .join(","),
        );
        csv.push_str("\r\n");
    }
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"payroll-{}-{}.csv\"",
                detail.run.period_start, detail.run.period_end
            ),
        )
        .body(Body::from(csv))
        .map_err(|_| AppError::internal("failed to build payroll export"))
}

async fn download_payslip(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((run_id, staff_id)): Path<(String, String)>,
) -> Result<Response<Body>, AppError> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    let pdf =
        staff_payroll_service::payslip_pdf(&state.db, &tenant_id, &branch_id, &run_id, &staff_id)
            .await?;
    Response::builder()
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"payslip-{}-{}.pdf\"",
                run_id, staff_id
            ),
        )
        .body(Body::from(pdf))
        .map_err(|_| AppError::internal("failed to build payslip"))
}

async fn list_statutory_profiles(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::staff_payroll_repository::StatutoryProfileRecord>> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    let rows =
        staff_payroll_service::list_statutory_profiles(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_statutory_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
) -> ApiResult<Option<crate::repositories::staff_payroll_repository::StatutoryProfileRecord>> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    let rows =
        staff_payroll_service::list_statutory_profiles(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter().find(|row| row.staff_id == staff_id),
    )))
}

async fn save_statutory_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Json(payload): Json<staff_payroll_service::StatutoryProfileInput>,
) -> ApiResult<crate::repositories::staff_payroll_repository::StatutoryProfileRecord> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    let result = staff_payroll_service::save_statutory_profile(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_payroll_periods(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::staff_payroll_repository::PayrollPeriodRecord>> {
    let (tenant_id, branch_id) = payroll_read_context(&claims, &headers)?;
    let rows =
        staff_payroll_service::list_payroll_periods(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn set_payroll_period_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<staff_payroll_service::PayrollPeriodScheduleInput>,
) -> ApiResult<crate::repositories::staff_payroll_repository::PayrollPeriodRecord> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    let row =
        staff_payroll_service::set_payroll_period_schedule(&state.db, &tenant_id, &branch_id, payload)
            .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn lock_payroll_period(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<staff_payroll_service::PayrollPeriodLockInput>,
) -> ApiResult<crate::repositories::staff_payroll_repository::PayrollPeriodRecord> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    let row = staff_payroll_service::lock_payroll_period(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn reopen_payroll_period(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(period_month): Path<NaiveDate>,
    Json(payload): Json<staff_payroll_service::PayrollPeriodReopenInput>,
) -> ApiResult<crate::repositories::staff_payroll_repository::PayrollPeriodRecord> {
    let (tenant_id, branch_id) = payroll_manage_context(&claims, &headers)?;
    let row = staff_payroll_service::reopen_payroll_period(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        period_month,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

fn csv_cell(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn payroll_read_context(
    claims: &AuthClaims,
    headers: &HeaderMap,
) -> Result<(String, String), AppError> {
    payroll_context(
        claims,
        headers,
        &["staff.payroll.read", "staff.payroll.manage"],
    )
}

fn payroll_manage_context(
    claims: &AuthClaims,
    headers: &HeaderMap,
) -> Result<(String, String), AppError> {
    payroll_context(claims, headers, &["staff.payroll.manage"])
}

fn payroll_context(
    claims: &AuthClaims,
    headers: &HeaderMap,
    permissions: &[&str],
) -> Result<(String, String), AppError> {
    ensure_payroll_access(claims, permissions)?;
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    if tenant_id != claims.tenant_id {
        return Err(AppError::forbidden("tenant context does not match token"));
    }
    if claims.branch_id.as_deref() != Some(branch_id.as_str()) {
        return Err(AppError::forbidden("branch context does not match token"));
    }
    Ok((tenant_id, branch_id))
}

fn ensure_payroll_access(claims: &AuthClaims, permissions: &[&str]) -> Result<(), AppError> {
    const ALLOWED_ROLES: &[&str] = &["owner", "admin", "accountant"];
    let denied = claims
        .denied_permissions
        .iter()
        .any(|denied| permissions.iter().any(|required| denied == required));
    let role_allowed = ALLOWED_ROLES
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role));
    let permission_allowed = claims
        .permissions
        .iter()
        .any(|allowed| permissions.iter().any(|required| allowed == required));
    if !denied && (role_allowed || permission_allowed) {
        Ok(())
    } else {
        Err(AppError::forbidden("payroll access is restricted"))
    }
}

fn validate_cycle(cycle: Option<&str>) -> Result<(), AppError> {
    if cycle.is_some_and(|value| !value.eq_ignore_ascii_case("monthly")) {
        return Err(AppError::validation(
            "only monthly payroll cycle is supported",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ensure_payroll_access, validate_cycle, RunPayrollRequest, SaveAdjustmentsRequest};
    use crate::services::auth_service::AuthClaims;
    use serde_json::json;

    #[test]
    fn payroll_cycle_is_monthly() {
        assert!(validate_cycle(None).is_ok());
        assert!(validate_cycle(Some("Monthly")).is_ok());
        assert!(validate_cycle(Some("weekly")).is_err());
    }

    #[test]
    fn payroll_guard_is_owner_admin_accountant_or_permission() {
        let mut manager_claims = claims("manager");
        assert!(ensure_payroll_access(&manager_claims, &["staff.payroll.manage"]).is_err());
        manager_claims
            .permissions
            .push("staff.payroll.manage".into());
        assert!(ensure_payroll_access(&manager_claims, &["staff.payroll.manage"]).is_ok());
        manager_claims
            .denied_permissions
            .push("staff.payroll.manage".into());
        assert!(ensure_payroll_access(&manager_claims, &["staff.payroll.manage"]).is_err());
        assert!(ensure_payroll_access(&claims("accountant"), &["staff.payroll.manage"]).is_ok());
    }

    #[test]
    fn salary_generation_body_rejects_client_amounts() {
        assert!(serde_json::from_value::<RunPayrollRequest>(json!({
            "cycle":"monthly","year":2026,"month":7,"staffId":"staff-1","netPaise":1
        }))
        .is_err());
        assert!(serde_json::from_value::<SaveAdjustmentsRequest>(json!({
            "entries":[{"staffId":"staff-1","adjustmentPaise":0,"netPaise":1}]
        }))
        .is_err());
    }

    fn claims(role: &str) -> AuthClaims {
        AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: role.into(),
            role_id: None,
            permissions: Vec::new(),
            denied_permissions: Vec::new(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            session_id: "session-1".into(),
            mfa_enrollment_required: false,
            token_type: "access".into(),
            jti: "token-1".into(),
            iat: 1,
            exp: usize::MAX,
        }
    }
}
