use crate::state::AppState;
use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::inventory_repository::{self, InventoryRecord},
    routes::context::tenant_branch,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json, Router,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryListQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryWriteRequest {
    pub sku: Option<String>,
    pub name: Option<String>,
    pub category: Option<String>,
    pub unit: Option<String>,
    pub stock_quantity: Option<i32>,
    pub reorder_point: Option<i32>,
    pub unit_cost_paise: Option<i64>,
    pub hsn_code: Option<String>,
    pub gst_percent: Option<i32>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub sku: String,
    pub name: String,
    pub category: String,
    pub unit: String,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub unit_cost_paise: i64,
    pub hsn_code: String,
    pub gst_percent: i32,
    pub active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/inventory",
            axum::routing::get(list_inventory).post(create_inventory),
        )
        .route("/inventory/:id", axum::routing::get(get_inventory))
        .route("/inventory/:id", axum::routing::patch(update_inventory))
        .route("/inventory/:id", axum::routing::delete(delete_inventory))
}

async fn list_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InventoryListQuery>,
) -> ApiResult<Vec<InventoryResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let q = query.q.unwrap_or_default();

    let rows = inventory_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list inventory"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(InventoryResponse::from).collect(),
    )))
}

async fn get_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<InventoryResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load inventory item"))?
        .ok_or_else(|| AppError::not_found("inventory item was not found"))?;

    Ok(Json(ApiResponse::ok(InventoryResponse::from(row))))
}

async fn create_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<InventoryWriteRequest>,
) -> ApiResult<InventoryResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let name = required_text(payload.name, "name is required")?;
    let hsn_code = tax_code(payload.hsn_code.as_deref(), "hsnCode")?;
    let row = inventory_repository::create(
        &state.db,
        inventory_repository::CreateInventory {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            sku: payload.sku.as_deref().unwrap_or_default(),
            name: &name,
            category: payload.category.as_deref().unwrap_or_default(),
            unit: payload.unit.as_deref().unwrap_or("pcs"),
            stock_quantity: non_negative_i32(payload.stock_quantity, "stockQuantity")?,
            reorder_point: non_negative_i32(payload.reorder_point, "reorderPoint")?,
            unit_cost_paise: non_negative_i64(payload.unit_cost_paise, "unitCostPaise")?,
            hsn_code: &hsn_code,
            gst_percent: non_negative_i32(payload.gst_percent, "gstPercent")?,
            active: payload.active.unwrap_or(true),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create inventory item"))?;

    Ok(Json(ApiResponse::ok(InventoryResponse::from(row))))
}

async fn update_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InventoryWriteRequest>,
) -> ApiResult<InventoryResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let hsn_code = payload
        .hsn_code
        .as_deref()
        .map(|value| tax_code(Some(value), "hsnCode"))
        .transpose()?;
    let row = inventory_repository::update(
        &state.db,
        inventory_repository::UpdateInventory {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            sku: payload.sku.as_deref(),
            name: payload.name.as_deref(),
            category: payload.category.as_deref(),
            unit: payload.unit.as_deref(),
            stock_quantity: payload.stock_quantity,
            reorder_point: payload.reorder_point,
            unit_cost_paise: payload.unit_cost_paise,
            hsn_code: hsn_code.as_deref(),
            gst_percent: payload.gst_percent.map(|value| value.max(0)),
            active: payload.active,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update inventory item"))?
    .ok_or_else(|| AppError::not_found("inventory item was not found"))?;

    Ok(Json(ApiResponse::ok(InventoryResponse::from(row))))
}

async fn delete_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<serde_json::Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let deleted = inventory_repository::delete(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to delete inventory item"))?;

    if deleted {
        Ok(Json(ApiResponse::ok(
            serde_json::json!({"deleted": true, "id": id}),
        )))
    } else {
        Err(AppError::not_found("inventory item was not found"))
    }
}

fn required_text(value: Option<String>, message: &'static str) -> Result<String, AppError> {
    value
        .map(|value| value.trim().to_string())
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

impl From<InventoryRecord> for InventoryResponse {
    fn from(record: InventoryRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            sku: record.sku,
            name: record.name,
            category: record.category,
            unit: record.unit,
            stock_quantity: record.stock_quantity,
            reorder_point: record.reorder_point,
            unit_cost_paise: record.unit_cost_paise,
            hsn_code: record.hsn_code,
            gst_percent: record.gst_percent,
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
