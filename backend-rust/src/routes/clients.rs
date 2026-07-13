use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::clients_repository::{self, ClientRecord, CreateClient, UpdateClient},
    routes::context::tenant_branch,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/clients", get(list_clients).post(create_client))
        .route("/clients/:id", get(get_client).patch(update_client))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientListQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientWriteRequest {
    pub code: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub membership_label: Option<String>,
    pub categories: Option<Vec<String>>,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub code: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub email: String,
    pub wallet_balance_paise: i64,
    pub duplicate_count: i64,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub membership_label: String,
    pub categories: Value,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

async fn list_clients(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ClientListQuery>,
) -> ApiResult<Vec<ClientResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let q = query.q.unwrap_or_default();

    let rows = clients_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list clients"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(ClientResponse::from).collect(),
    )))
}

async fn get_client(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ClientResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .ok_or_else(|| AppError::not_found("client was not found"))?;

    Ok(Json(ApiResponse::ok(ClientResponse::from(row))))
}

async fn create_client(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ClientWriteRequest>,
) -> ApiResult<ClientResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let first_name = payload
        .first_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::validation("firstName is required"))?;
    let categories_json = categories_json(payload.categories.as_ref())?;

    let row = clients_repository::create(
        &state.db,
        CreateClient {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            code: payload.code.as_deref(),
            first_name,
            last_name: payload.last_name.as_deref().unwrap_or(""),
            phone: payload.phone.as_deref().unwrap_or(""),
            email: payload.email.as_deref().unwrap_or(""),
            membership_label: payload.membership_label.as_deref().unwrap_or(""),
            categories_json: &categories_json,
            birthday: payload.birthday,
            anniversary: payload.anniversary,
            notes: payload.notes.as_deref(),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create client"))?;

    Ok(Json(ApiResponse::ok(ClientResponse::from(row))))
}

async fn update_client(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientWriteRequest>,
) -> ApiResult<ClientResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let categories_json = payload
        .categories
        .as_ref()
        .map(|categories| categories_json(Some(categories)))
        .transpose()?;

    let row = clients_repository::update(
        &state.db,
        UpdateClient {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            code: payload.code.as_deref(),
            first_name: payload.first_name.as_deref(),
            last_name: payload.last_name.as_deref(),
            phone: payload.phone.as_deref(),
            email: payload.email.as_deref(),
            membership_label: payload.membership_label.as_deref(),
            categories_json: categories_json.as_deref(),
            birthday: payload.birthday,
            anniversary: payload.anniversary,
            notes: payload.notes.as_deref(),
            active: payload.active,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update client"))?
    .ok_or_else(|| AppError::not_found("client was not found"))?;

    Ok(Json(ApiResponse::ok(ClientResponse::from(row))))
}

fn categories_json(categories: Option<&Vec<String>>) -> Result<String, AppError> {
    let empty = Vec::new();
    serde_json::to_string(categories.unwrap_or(&empty))
        .map_err(|_| AppError::validation("categories must be valid strings"))
}

impl From<ClientRecord> for ClientResponse {
    fn from(record: ClientRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            code: record.code,
            first_name: record.first_name,
            last_name: record.last_name,
            phone: record.phone,
            email: record.email,
            wallet_balance_paise: record.wallet_balance_paise,
            duplicate_count: record.duplicate_count,
            last_visit_at: record.last_visit_at,
            membership_label: record.membership_label,
            categories: serde_json::from_str(&record.categories_json)
                .unwrap_or(Value::Array(vec![])),
            birthday: record.birthday,
            anniversary: record.anniversary,
            notes: record.notes,
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
