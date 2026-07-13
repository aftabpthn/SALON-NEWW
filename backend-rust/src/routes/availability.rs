use crate::state::AppState;
use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::availability_repository::{self, AvailabilityRecord},
    routes::context::tenant_branch,
};
use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json, Router,
};
use chrono::NaiveTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityListQuery {
    pub staff_id: Option<String>,
    pub weekday: Option<u8>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityWriteRequest {
    pub staff_id: String,
    pub weekday: u8,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: String,
    #[serde(rename = "isAvailable")]
    pub is_available: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub staff_id: String,
    pub weekday: u8,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: String,
    #[serde(rename = "isAvailable")]
    pub is_available: bool,
    pub reason: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/availability", axum::routing::get(list_availability))
        .route("/availability", axum::routing::post(create_availability))
        .route(
            "/availability/:id",
            axum::routing::patch(update_availability),
        )
        .route(
            "/availability/:id",
            axum::routing::delete(delete_availability),
        )
}

async fn list_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AvailabilityListQuery>,
) -> ApiResult<Vec<AvailabilityResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(200).clamp(1, 500);
    let list = availability_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref(),
        query.weekday,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to load availability"))?;

    Ok(Json(ApiResponse::ok(
        list.into_iter().map(AvailabilityResponse::from).collect(),
    )))
}

async fn create_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AvailabilityWriteRequest>,
) -> ApiResult<AvailabilityResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = required_text(&payload.staff_id, "staffId is required")?;
    let weekday = valid_weekday(payload.weekday)?;
    let start_time = parse_time(&payload.start_time, "startTime")?;
    let end_time = parse_time(&payload.end_time, "endTime")?;
    validate_time_order(start_time, end_time)?;
    let is_available = payload.is_available.unwrap_or(true);
    let reason = payload.reason.unwrap_or_default().trim().to_string();

    let row = availability_repository::create(
        &state.db,
        availability_repository::CreateAvailability {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            staff_id,
            weekday,
            start_time: &start_time,
            end_time: &end_time,
            is_available,
            reason: &reason,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create availability"))?;

    Ok(Json(ApiResponse::ok(AvailabilityResponse::from(row))))
}

async fn update_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<AvailabilityWriteRequest>,
) -> ApiResult<AvailabilityResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = required_text(&payload.staff_id, "staffId is required")?;
    let weekday = valid_weekday(payload.weekday)?;
    let start_time = parse_time(&payload.start_time, "startTime")?;
    let end_time = parse_time(&payload.end_time, "endTime")?;
    validate_time_order(start_time, end_time)?;
    let reason = payload.reason.unwrap_or_default().trim().to_string();

    let row = availability_repository::update(
        &state.db,
        availability_repository::UpdateAvailability {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            staff_id: Some(staff_id),
            weekday: Some(weekday),
            start_time: Some(&start_time),
            end_time: Some(&end_time),
            is_available: payload.is_available,
            reason: Some(&reason),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update availability"))?
    .ok_or_else(|| AppError::not_found("availability slot was not found"))?;

    Ok(Json(ApiResponse::ok(AvailabilityResponse::from(row))))
}

async fn delete_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResult<serde_json::Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let deleted = availability_repository::delete(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to delete availability"))?;

    if deleted {
        Ok(Json(ApiResponse::ok(
            serde_json::json!({"deleted": true, "id": id}),
        )))
    } else {
        Err(AppError::not_found("availability slot was not found"))
    }
}

fn required_text<'a>(value: &'a str, message: &'static str) -> Result<&'a str, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation(message));
    }
    Ok(trimmed)
}

fn valid_weekday(weekday: u8) -> Result<u8, AppError> {
    if weekday > 6 {
        return Err(AppError::validation("weekday must be between 0 and 6"));
    }
    Ok(weekday)
}

fn validate_time_order(start_time: NaiveTime, end_time: NaiveTime) -> Result<(), AppError> {
    if start_time >= end_time {
        return Err(AppError::validation("startTime must be before endTime"));
    }
    Ok(())
}

fn parse_time(raw: &str, field: &'static str) -> Result<NaiveTime, AppError> {
    let raw = raw.trim();
    NaiveTime::parse_from_str(raw, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(raw, "%H:%M"))
        .map_err(|_| AppError::validation(format!("{field} must be HH:mm or HH:mm:ss")))
}

impl From<AvailabilityRecord> for AvailabilityResponse {
    fn from(record: AvailabilityRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            staff_id: record.staff_id,
            weekday: record.weekday as u8,
            start_time: record.start_time.format("%H:%M").to_string(),
            end_time: record.end_time.format("%H:%M").to_string(),
            is_available: record.is_available,
            reason: record.reason,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
