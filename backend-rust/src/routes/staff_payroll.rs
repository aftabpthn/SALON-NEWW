use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, staff_payroll_service},
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
        .route("/staff-payroll/runs/:run_id/export", get(export_run))
        .route(
            "/staff-payroll/runs/:run_id/payslips/:staff_id",
            get(download_payslip),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeriodQuery {
    cycle: Option<String>,
    year: i32,
    month: u32,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunPayrollRequest {
    cycle: Option<String>,
    year: i32,
    month: u32,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAdjustmentsRequest {
    entries: Vec<SaveAdjustmentEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAdjustmentEntry {
    staff_id: String,
    adjustment_paise: i64,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayoutRequest {
    payment_method: String,
    reference: Option<String>,
    idempotency_key: String,
}

async fn preview(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<PeriodQuery>,
) -> ApiResult<staff_payroll_service::PayrollPreview> {
    ensure_payroll_access(&claims)?;
    validate_cycle(query.cycle.as_deref())?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
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
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_payroll_service::list_runs(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn run_payroll(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<RunPayrollRequest>,
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    ensure_payroll_access(&claims)?;
    validate_cycle(payload.cycle.as_deref())?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = staff_payroll_service::run_payroll(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload.year,
        payload.month,
        payload.staff_id.as_deref().unwrap_or("").trim(),
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
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
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
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
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
    let (tenant_id, branch_id) = payroll_context(&claims, &headers)?;
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
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_context(&claims, &headers)?;
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
) -> ApiResult<staff_payroll_service::PayrollRunDetail> {
    let (tenant_id, branch_id) = payroll_context(&claims, &headers)?;
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
    let (tenant_id, branch_id) = payroll_context(&claims, &headers)?;
    let result = staff_payroll_service::record_payout(
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

async fn export_run(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(run_id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let (tenant_id, branch_id) = payroll_context(&claims, &headers)?;
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
                paise_text(item.earned_salary_paise),
                paise_text(item.overtime_paise),
                paise_text(item.commission_paise),
                paise_text(item.adjustment_paise),
                paise_text(item.deductions_paise),
                paise_text(item.net_paise),
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
    let (tenant_id, branch_id) = payroll_context(&claims, &headers)?;
    let detail = staff_payroll_service::detail(&state.db, &tenant_id, &branch_id, &run_id).await?;
    if !matches!(detail.run.status.as_str(), "finalized" | "paid") {
        return Err(AppError::conflict(
            "payslips are available after payroll finalization",
        ));
    }
    let item = detail
        .items
        .iter()
        .find(|item| item.staff_id == staff_id)
        .ok_or_else(|| AppError::not_found("payroll employee not found"))?;
    let lines = vec![
        format!("Employee: {}", item.staff_name),
        format!(
            "Employee code: {}",
            item.employee_code.as_deref().unwrap_or("-")
        ),
        format!(
            "Period: {} to {}",
            detail.run.period_start, detail.run.period_end
        ),
        format!("Status: {}", detail.run.status),
        format!(
            "Earned salary: INR {}",
            paise_text(item.earned_salary_paise)
        ),
        format!("Overtime: INR {}", paise_text(item.overtime_paise)),
        format!("Commission: INR {}", paise_text(item.commission_paise)),
        format!("Adjustment: INR {}", paise_text(item.adjustment_paise)),
        format!("Deductions: INR {}", paise_text(item.deductions_paise)),
        format!("Net pay: INR {}", paise_text(item.net_paise)),
    ];
    let pdf = crate::services::invoice_pdf::render_text_report("STAFF PAYSLIP", &lines);
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

fn csv_cell(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn paise_text(value: i64) -> String {
    format!("{}.{:02}", value / 100, value.unsigned_abs() % 100)
}

fn payroll_context(claims: &AuthClaims, headers: &HeaderMap) -> Result<(String, String), AppError> {
    ensure_payroll_access(claims)?;
    tenant_branch(headers)
}

fn ensure_payroll_access(claims: &AuthClaims) -> Result<(), AppError> {
    const ALLOWED: &[&str] = &["owner", "admin", "manager", "accountant"];
    if ALLOWED
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
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
    use super::validate_cycle;

    #[test]
    fn payroll_cycle_is_monthly() {
        assert!(validate_cycle(None).is_ok());
        assert!(validate_cycle(Some("Monthly")).is_ok());
        assert!(validate_cycle(Some("weekly")).is_err());
    }
}
