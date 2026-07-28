use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{NaiveDate, NaiveTime};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::staff_schedule_repository::ScheduleEntryInput,
    routes::context::tenant_branch,
    services::staff_schedule_service,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff-schedule", get(get_schedule).put(save_schedule))
        .route("/staff-schedule/copy", post(copy_schedule))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleQuery {
    date_from: NaiveDate,
    date_to: NaiveDate,
    role_id: Option<String>,
    job: Option<String>,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveScheduleRequest {
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_ids: Vec<String>,
    entries: Vec<ScheduleEntryRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleEntryRequest {
    staff_id: String,
    schedule_date: NaiveDate,
    shift1_start: Option<String>,
    shift1_end: Option<String>,
    shift2_start: Option<String>,
    shift2_end: Option<String>,
    status: String,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyScheduleRequest {
    source_start: NaiveDate,
    target_start: NaiveDate,
    staff_ids: Vec<String>,
}

async fn get_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ScheduleQuery>,
) -> ApiResult<staff_schedule_service::ScheduleData> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let data = staff_schedule_service::load(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date_from,
        query.date_to,
        query.role_id.as_deref().unwrap_or("").trim(),
        query.job.as_deref().unwrap_or("").trim(),
        query.staff_id.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(data)))
}

async fn save_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SaveScheduleRequest>,
) -> ApiResult<serde_json::Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let entries = payload
        .entries
        .into_iter()
        .map(|entry| {
            Ok(ScheduleEntryInput {
                staff_id: entry.staff_id.trim().to_string(),
                schedule_date: entry.schedule_date,
                shift1_start: parse_optional_time(entry.shift1_start.as_deref(), "shift1Start")?,
                shift1_end: parse_optional_time(entry.shift1_end.as_deref(), "shift1End")?,
                shift2_start: parse_optional_time(entry.shift2_start.as_deref(), "shift2Start")?,
                shift2_end: parse_optional_time(entry.shift2_end.as_deref(), "shift2End")?,
                status: entry.status.trim().to_lowercase(),
                notes: entry.notes.unwrap_or_default().trim().to_string(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    staff_schedule_service::save(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.date_from,
        payload.date_to,
        payload
            .staff_ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .collect(),
        entries,
    )
    .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({"saved": true}))))
}

async fn copy_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CopyScheduleRequest>,
) -> ApiResult<serde_json::Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    staff_schedule_service::copy_week(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.source_start,
        payload.target_start,
        payload
            .staff_ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .collect(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({"copied": true}))))
}

fn parse_optional_time(
    raw: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveTime>, AppError> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    NaiveTime::parse_from_str(raw, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(raw, "%H:%M:%S"))
        .map(Some)
        .map_err(|_| AppError::validation(format!("{field} must be HH:mm")))
}

#[cfg(test)]
mod tests {
    use super::parse_optional_time;

    #[test]
    fn optional_time_accepts_empty_and_hh_mm() {
        assert!(parse_optional_time(Some(""), "shift").unwrap().is_none());
        assert!(parse_optional_time(Some("09:30"), "shift")
            .unwrap()
            .is_some());
        assert!(parse_optional_time(Some("25:00"), "shift").is_err());
    }
}
