use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_attendance_repository::{
            AttendanceAdjustmentInput, AttendanceBreakInput, AttendanceCorrectionInput,
        },
    },
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, staff_attendance_service, staff_enterprise_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff-attendance/summary",
            get(get_summary).put(save_summary),
        )
        .route(
            "/staff-attendance/summary/recalculate",
            post(recalculate_summary),
        )
        .route("/staff-attendance/:staff_id/details", get(get_details))
        .route("/staff-attendance/clock-in", post(clock_in))
        .route("/staff-attendance/clock-out", post(clock_out))
        .route("/staff-attendance/break-start", post(start_break))
        .route("/staff-attendance/break-end", post(end_break))
        .route(
            "/staff-attendance/:staff_id/:business_date/correction",
            axum::routing::patch(correct_attendance),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryQuery {
    cycle: Option<String>,
    year: i32,
    month: u32,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSummaryRequest {
    year: i32,
    month: u32,
    entries: Vec<SaveSummaryEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSummaryEntry {
    staff_id: String,
    weekly_off_adjustment: f64,
    special_leave_adjustment: f64,
    comments: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClockInRequest {
    staff_id: String,
    business_date: NaiveDate,
    clock_in_at: Option<DateTime<Utc>>,
    source: Option<String>,
    comments: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClockOutRequest {
    staff_id: String,
    business_date: NaiveDate,
    clock_out_at: Option<DateTime<Utc>>,
    penalty_paise: Option<i64>,
    comments: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BreakRequest {
    staff_id: String,
    business_date: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttendanceCorrectionRequest {
    clock_in_at: Option<DateTime<Utc>>,
    clock_out_at: Option<DateTime<Utc>>,
    manual_status: Option<String>,
    penalty_paise: Option<i64>,
    comments: Option<String>,
    correction_reason: String,
    #[serde(default)]
    breaks: Vec<AttendanceBreakRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttendanceBreakRequest {
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    comments: Option<String>,
}

async fn get_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SummaryQuery>,
) -> ApiResult<Vec<staff_attendance_service::AttendanceSummaryRow>> {
    validate_cycle(query.cycle.as_deref())?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_attendance_service::summary(
        &state.db,
        &tenant_id,
        &branch_id,
        query.year,
        query.month,
        query.staff_id.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn recalculate_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SummaryQuery>,
) -> ApiResult<Vec<staff_attendance_service::AttendanceSummaryRow>> {
    get_summary(State(state), headers, Query(query)).await
}

async fn save_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SaveSummaryRequest>,
) -> ApiResult<Vec<staff_attendance_service::AttendanceSummaryRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_attendance_service::save_adjustments(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.year,
        payload.month,
        payload
            .entries
            .into_iter()
            .map(|entry| AttendanceAdjustmentInput {
                staff_id: entry.staff_id.trim().to_string(),
                weekly_off_adjustment: entry.weekly_off_adjustment,
                special_leave_adjustment: entry.special_leave_adjustment,
                comments: entry.comments.trim().to_string(),
            })
            .collect(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_details(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Query(query): Query<SummaryQuery>,
) -> ApiResult<Vec<crate::repositories::staff_attendance_repository::AttendanceDetailRecord>> {
    validate_cycle(query.cycle.as_deref())?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_attendance_service::details(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        query.year,
        query.month,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn clock_in(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClockInRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let row = staff_attendance_service::clock_in(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
        payload.clock_in_at,
        payload.source.as_deref().unwrap_or("manual").trim(),
        payload.comments.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn clock_out(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClockOutRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let self_service = claims.role.eq_ignore_ascii_case("staff");
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let row = staff_attendance_service::clock_out(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
        payload.clock_out_at,
        if self_service {
            0
        } else {
            payload.penalty_paise.unwrap_or(0)
        },
        payload.comments.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn start_break(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BreakRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceBreakRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let row = staff_attendance_service::start_break(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
        &claims.sub,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn end_break(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BreakRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let row = staff_attendance_service::end_break(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn self_scoped_staff_id(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    requested_staff_id: &str,
) -> Result<String, AppError> {
    if claims.role.eq_ignore_ascii_case("staff") {
        staff_enterprise_service::self_staff_id(&state.db, tenant_id, branch_id, &claims.sub).await
    } else {
        Ok(requested_staff_id.to_string())
    }
}

async fn correct_attendance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((staff_id, business_date)): Path<(String, NaiveDate)>,
    Json(payload): Json<AttendanceCorrectionRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_attendance_service::correct_attendance(
        &state.db,
        &tenant_id,
        &branch_id,
        staff_id.trim(),
        business_date,
        AttendanceCorrectionInput {
            clock_in_at: payload.clock_in_at,
            clock_out_at: payload.clock_out_at,
            manual_status: payload
                .manual_status
                .map(|value| value.trim().to_lowercase())
                .filter(|value| !value.is_empty()),
            penalty_paise: payload.penalty_paise.unwrap_or(0),
            comments: payload.comments.unwrap_or_default().trim().to_string(),
            correction_reason: payload.correction_reason.trim().to_string(),
            corrected_by: claims.sub.clone(),
            breaks: payload
                .breaks
                .into_iter()
                .map(|item| AttendanceBreakInput {
                    started_at: item.started_at,
                    ended_at: item.ended_at,
                    comments: item.comments.unwrap_or_default().trim().to_string(),
                })
                .collect(),
        },
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.attendance.corrected",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: serde_json::json!({ "staffId": staff_id, "businessDate": business_date }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

fn validate_cycle(cycle: Option<&str>) -> Result<(), AppError> {
    if cycle.is_some_and(|value| !value.eq_ignore_ascii_case("monthly")) {
        return Err(AppError::validation(
            "only monthly attendance cycle is supported",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_cycle;

    #[test]
    fn attendance_cycle_is_monthly() {
        assert!(validate_cycle(None).is_ok());
        assert!(validate_cycle(Some("Monthly")).is_ok());
        assert!(validate_cycle(Some("weekly")).is_err());
    }
}
