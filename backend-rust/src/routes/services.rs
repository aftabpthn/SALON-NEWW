use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::services_repository::{self, CreateService, ServiceRecord, UpdateService},
    routes::context::tenant_branch,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/services", get(list_services).post(create_service))
        .route("/services/:id", get(get_service).patch(update_service))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceListQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductConsumptionLine {
    pub product_id: Option<String>,
    pub product_name: Option<String>,
    pub unit: String,
    pub min_qty: f64,
    pub standard_qty: f64,
    pub max_qty: f64,
    pub waste_percent: f64,
    pub owner_approval_percent: f64,
    pub hit_limit: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceWriteRequest {
    pub name: Option<String>,
    pub category: Option<String>,
    pub duration_minutes: Option<i32>,
    pub price_paise: Option<i64>,
    pub gst_percent: Option<i32>,
    pub sac_code: Option<String>,
    pub wait_time_minutes: Option<i32>,
    pub cleanup_time_minutes: Option<i32>,
    pub buffer_time_minutes: Option<i32>,
    pub product_consumption: Option<Vec<ProductConsumptionLine>>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub category: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub gst_percent: i32,
    pub sac_code: String,
    pub wait_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub buffer_time_minutes: i32,
    pub product_consumption: Value,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

async fn list_services(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ServiceListQuery>,
) -> ApiResult<Vec<ServiceResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let q = query.q.unwrap_or_default();

    let rows = services_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list services"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(ServiceResponse::from).collect(),
    )))
}

async fn get_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ServiceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = services_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load service"))?
        .ok_or_else(|| AppError::not_found("service was not found"))?;

    Ok(Json(ApiResponse::ok(ServiceResponse::from(row))))
}

async fn create_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ServiceWriteRequest>,
) -> ApiResult<ServiceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let name = required_text(payload.name.as_deref(), "name is required")?;
    let product_consumption_json = product_consumption_json(payload.product_consumption.as_ref())?;
    let sac_code = tax_code(payload.sac_code.as_deref(), "sacCode")?;

    let row = services_repository::create(
        &state.db,
        CreateService {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            name,
            category: payload.category.as_deref().unwrap_or(""),
            duration_minutes: non_negative_i32(payload.duration_minutes, "durationMinutes")?,
            price_paise: non_negative_i64(payload.price_paise, "pricePaise")?,
            gst_percent: non_negative_i32(payload.gst_percent, "gstPercent")?,
            sac_code: &sac_code,
            wait_time_minutes: non_negative_i32(payload.wait_time_minutes, "waitTimeMinutes")?,
            cleanup_time_minutes: non_negative_i32(
                payload.cleanup_time_minutes,
                "cleanupTimeMinutes",
            )?,
            buffer_time_minutes: non_negative_i32(
                payload.buffer_time_minutes,
                "bufferTimeMinutes",
            )?,
            product_consumption_json: &product_consumption_json,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create service"))?;

    Ok(Json(ApiResponse::ok(ServiceResponse::from(row))))
}

async fn update_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ServiceWriteRequest>,
) -> ApiResult<ServiceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let product_consumption_json = payload
        .product_consumption
        .as_ref()
        .map(|lines| product_consumption_json(Some(lines)))
        .transpose()?;
    let sac_code = payload
        .sac_code
        .as_deref()
        .map(|value| tax_code(Some(value), "sacCode"))
        .transpose()?;

    let row = services_repository::update(
        &state.db,
        UpdateService {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            name: payload.name.as_deref(),
            category: payload.category.as_deref(),
            duration_minutes: payload.duration_minutes.map(|value| value.max(0)),
            price_paise: payload.price_paise.map(|value| value.max(0)),
            gst_percent: payload.gst_percent.map(|value| value.max(0)),
            sac_code: sac_code.as_deref(),
            wait_time_minutes: payload.wait_time_minutes.map(|value| value.max(0)),
            cleanup_time_minutes: payload.cleanup_time_minutes.map(|value| value.max(0)),
            buffer_time_minutes: payload.buffer_time_minutes.map(|value| value.max(0)),
            product_consumption_json: product_consumption_json.as_deref(),
            active: payload.active,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update service"))?
    .ok_or_else(|| AppError::not_found("service was not found"))?;

    Ok(Json(ApiResponse::ok(ServiceResponse::from(row))))
}

fn required_text<'a>(value: Option<&'a str>, message: &'static str) -> Result<&'a str, AppError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation(message))
}

fn non_negative_i32(value: Option<i32>, field: &'static str) -> Result<i32, AppError> {
    value
        .unwrap_or(0)
        .ge(&0)
        .then_some(value.unwrap_or(0))
        .ok_or_else(|| AppError::validation(format!("{field} must be 0 or greater")))
}

fn non_negative_i64(value: Option<i64>, field: &'static str) -> Result<i64, AppError> {
    value
        .unwrap_or(0)
        .ge(&0)
        .then_some(value.unwrap_or(0))
        .ok_or_else(|| AppError::validation(format!("{field} must be 0 or greater")))
}

fn tax_code(value: Option<&str>, field: &'static str) -> Result<String, AppError> {
    let code = value.unwrap_or_default().trim().to_string();
    if !code.is_empty()
        && (!code.chars().all(|ch| ch.is_ascii_digit()) || !(4..=8).contains(&code.len()))
    {
        return Err(AppError::validation(format!(
            "{field} must contain 4 to 8 digits"
        )));
    }
    Ok(code)
}

fn product_consumption_json(
    lines: Option<&Vec<ProductConsumptionLine>>,
) -> Result<String, AppError> {
    let empty = Vec::new();
    serde_json::to_string(lines.unwrap_or(&empty))
        .map_err(|_| AppError::validation("productConsumption must be valid"))
}

impl From<ServiceRecord> for ServiceResponse {
    fn from(record: ServiceRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            name: record.name,
            category: record.category,
            duration_minutes: record.duration_minutes,
            price_paise: record.price_paise,
            gst_percent: record.gst_percent,
            sac_code: record.sac_code,
            wait_time_minutes: record.wait_time_minutes,
            cleanup_time_minutes: record.cleanup_time_minutes,
            buffer_time_minutes: record.buffer_time_minutes,
            product_consumption: serde_json::from_str(&record.product_consumption_json)
                .unwrap_or(Value::Array(vec![])),
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
