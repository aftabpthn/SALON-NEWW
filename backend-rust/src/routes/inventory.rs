use crate::state::AppState;
use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::inventory_repository::{self, InventoryRecord},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        inventory_adjustment_service::{self, InventoryUpdateInput},
        inventory_controls_service,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
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
pub struct AdvancedControlsQuery {
    pub dead_stock_days: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlReconciliationQuery {
    pub as_of: Option<chrono::NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryLedgerQuery {
    pub from: Option<chrono::NaiveDate>,
    pub to: Option<chrono::NaiveDate>,
    pub movement: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryValuationQuery {
    pub as_of: Option<chrono::NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackbarUsageQuery {
    pub date: Option<chrono::NaiveDate>,
    pub staff_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackbarUsageRequest {
    pub inventory_item_id: String,
    pub service_id: Option<String>,
    pub staff_id: Option<String>,
    pub actual_quantity: i32,
    pub notes: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackbarReviewRequest {
    pub decision: String,
    pub review_note: Option<String>,
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
    pub barcode: Option<String>,
    pub batch_tracked: Option<bool>,
    pub active: Option<bool>,
    pub adjustment_reason: Option<String>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitComponentRequest {
    pub inventory_item_id: String,
    pub quantity: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitRequest {
    pub components: Vec<KitComponentRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitAssemblyRequest {
    pub quantity: i32,
    pub idempotency_key: String,
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
    pub barcode: String,
    pub batch_tracked: bool,
    pub active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Product360Response {
    pub product: InventoryResponse,
    pub stock_in_quantity: i64,
    pub stock_out_quantity: i64,
    pub last_movement_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_receipt_date: Option<chrono::NaiveDate>,
    pub last_supplier: Option<String>,
    pub recipe_count: i64,
    pub consumed_quantity: i64,
    pub kit_components: Vec<inventory_repository::InventoryKitComponentRecord>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/inventory",
            axum::routing::get(list_inventory).post(create_inventory),
        )
        .route(
            "/inventory/advanced-controls",
            axum::routing::get(advanced_controls),
        )
        .route(
            "/inventory/gl-reconciliation",
            axum::routing::get(gl_reconciliation),
        )
        .route("/inventory/ledger", axum::routing::get(stock_ledger))
        .route(
            "/inventory/reorder-suggestions",
            axum::routing::get(reorder_suggestions),
        )
        .route("/inventory/valuation", axum::routing::get(valuation))
        .route("/inventory/batches", get(list_batches))
        .route(
            "/inventory/backbar-usage",
            axum::routing::get(list_backbar_usage).post(record_backbar_usage),
        )
        .route(
            "/inventory/backbar-usage/:id/review",
            axum::routing::patch(review_backbar_usage),
        )
        .route("/inventory/:id/360", axum::routing::get(product_360))
        .route("/inventory/:id/kit", get(get_kit).put(save_kit))
        .route("/inventory/:id/assemble", post(assemble_kit))
        .route("/inventory/:id", axum::routing::get(get_inventory))
        .route("/inventory/:id", axum::routing::patch(update_inventory))
        .route("/inventory/:id", axum::routing::delete(delete_inventory))
}

async fn list_batches(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<inventory_repository::InventoryBatchRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_repository::list_batches(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list inventory batches"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_kit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<inventory_repository::InventoryKitComponentRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    inventory_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to validate kit item"))?
        .ok_or_else(|| AppError::not_found("kit item was not found"))?;
    let rows = inventory_repository::kit_components(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load kit components"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_kit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<KitRequest>,
) -> ApiResult<Vec<inventory_repository::InventoryKitComponentRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_adjustment_service::save_kit_components(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        payload
            .components
            .into_iter()
            .map(|row| inventory_adjustment_service::KitComponentInput {
                inventory_item_id: row.inventory_item_id,
                quantity: row.quantity,
            })
            .collect(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn assemble_kit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<KitAssemblyRequest>,
) -> ApiResult<inventory_adjustment_service::KitAssemblyResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_adjustment_service::assemble_kit(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        payload.quantity,
        &payload.idempotency_key,
        &claims.sub,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_backbar_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BackbarUsageQuery>,
) -> ApiResult<Vec<inventory_repository::BackbarUsageRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_repository::list_backbar_usage(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date,
        query.staff_id.as_deref().unwrap_or_default(),
        query.limit.unwrap_or(250).clamp(1, 1000),
    )
    .await
    .map_err(|_| AppError::internal("failed to list backbar usage"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn record_backbar_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<BackbarUsageRequest>,
) -> ApiResult<inventory_repository::BackbarUsageRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_adjustment_service::record_backbar_usage(
        &state,
        inventory_adjustment_service::BackbarUsageInput {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            inventory_item_id: &payload.inventory_item_id,
            service_id: payload.service_id.as_deref(),
            staff_id: payload.staff_id.as_deref(),
            actual_quantity: payload.actual_quantity,
            notes: payload.notes.as_deref().unwrap_or_default(),
            actor_user_id: &claims.sub,
            idempotency_key: &payload.idempotency_key,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn review_backbar_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<BackbarReviewRequest>,
) -> ApiResult<inventory_repository::BackbarUsageRecord> {
    if !claims.role.eq_ignore_ascii_case("owner")
        && !claims
            .permissions
            .iter()
            .any(|permission| permission == "inventory.approve")
    {
        return Err(AppError::forbidden(
            "owner approval is required for recipe wastage",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_adjustment_service::review_backbar_usage(
        &state,
        inventory_adjustment_service::BackbarReviewInput {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            usage_id: &id,
            decision: payload.decision.trim(),
            review_note: payload.review_note.as_deref().unwrap_or_default(),
            actor_user_id: &claims.sub,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn advanced_controls(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AdvancedControlsQuery>,
) -> ApiResult<inventory_controls_service::AdvancedControlsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let response = inventory_controls_service::advanced_controls(
        &state,
        &tenant_id,
        &branch_id,
        query.dead_stock_days.unwrap_or(90).clamp(7, 730),
        query.limit.unwrap_or(80).clamp(1, 250),
    )
    .await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn gl_reconciliation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GlReconciliationQuery>,
) -> ApiResult<inventory_controls_service::GlReconciliationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let today = chrono::Utc::now().date_naive();
    let as_of = query.as_of.unwrap_or(today);
    if as_of > today {
        return Err(AppError::validation("asOf cannot be in the future"));
    }
    let response =
        inventory_controls_service::gl_reconciliation(&state, &tenant_id, &branch_id, as_of)
            .await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn stock_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InventoryLedgerQuery>,
) -> ApiResult<Vec<inventory_repository::InventoryLedgerRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if query.from.zip(query.to).is_some_and(|(from, to)| from > to) {
        return Err(AppError::validation("from cannot be after to"));
    }
    let movement = query.movement.unwrap_or_default();
    const MOVEMENTS: &[&str] = &[
        "sale",
        "return",
        "purchase",
        "purchase_return",
        "transfer_out",
        "transfer_in",
        "transfer_reversal",
        "adjustment",
        "consumption",
    ];
    if !movement.is_empty() && !MOVEMENTS.contains(&movement.as_str()) {
        return Err(AppError::validation("movement is not supported"));
    }
    let rows = inventory_repository::list_ledger(
        &state.db,
        &tenant_id,
        &branch_id,
        query.from,
        query.to,
        &movement,
        query.q.as_deref().unwrap_or_default().trim(),
        query.limit.unwrap_or(500).clamp(1, 2000),
    )
    .await
    .map_err(|_| AppError::internal("failed to load stock ledger"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn reorder_suggestions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<inventory_controls_service::ReorderSuggestion>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        inventory_controls_service::reorder_suggestions(&state, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn valuation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InventoryValuationQuery>,
) -> ApiResult<Vec<inventory_repository::InventoryValuationRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let today = chrono::Utc::now().date_naive();
    let as_of = query.as_of.unwrap_or(today);
    if as_of > today {
        return Err(AppError::validation("asOf cannot be in the future"));
    }
    let rows = inventory_repository::valuation(&state.db, &tenant_id, &branch_id, as_of)
        .await
        .map_err(|_| AppError::internal("failed to load inventory valuation"))?;
    Ok(Json(ApiResponse::ok(rows)))
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

async fn product_360(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Product360Response> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (product, summary, kit_components) = tokio::try_join!(
        inventory_repository::get(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::product_360_summary(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::kit_components(&state.db, &tenant_id, &branch_id, &id),
    )
    .map_err(|_| AppError::internal("failed to load product details"))?;
    let product = product.ok_or_else(|| AppError::not_found("inventory item was not found"))?;

    Ok(Json(ApiResponse::ok(Product360Response {
        product: InventoryResponse::from(product),
        stock_in_quantity: summary.stock_in_quantity,
        stock_out_quantity: summary.stock_out_quantity,
        last_movement_at: summary.last_movement_at,
        last_receipt_date: summary.last_receipt_date,
        last_supplier: summary.last_supplier,
        recipe_count: summary.recipe_count,
        consumed_quantity: summary.consumed_quantity,
        kit_components,
    })))
}

async fn create_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<InventoryWriteRequest>,
) -> ApiResult<InventoryResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let name = required_text(payload.name, "name is required")?;
    let hsn_code = tax_code(payload.hsn_code.as_deref(), "hsnCode")?;
    let barcode = barcode(payload.barcode.as_deref())?;
    let stock_quantity = non_negative_i32(payload.stock_quantity, "stockQuantity")?;
    if payload.batch_tracked.unwrap_or(false) && stock_quantity > 0 {
        return Err(AppError::validation(
            "batch-tracked products must start at zero stock and be received through a GRN",
        ));
    }
    let row = inventory_repository::create(
        &state.db,
        inventory_repository::CreateInventory {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            sku: payload.sku.as_deref().unwrap_or_default(),
            name: &name,
            category: payload.category.as_deref().unwrap_or_default(),
            unit: payload.unit.as_deref().unwrap_or("pcs"),
            stock_quantity,
            reorder_point: non_negative_i32(payload.reorder_point, "reorderPoint")?,
            unit_cost_paise: non_negative_i64(payload.unit_cost_paise, "unitCostPaise")?,
            hsn_code: &hsn_code,
            gst_percent: non_negative_i32(payload.gst_percent, "gstPercent")?,
            barcode: &barcode,
            batch_tracked: payload.batch_tracked.unwrap_or(false),
            active: payload.active.unwrap_or(true),
        },
    )
    .await
    .map_err(|_| AppError::conflict("SKU or barcode already exists in this branch"))?;

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
    let barcode = payload
        .barcode
        .as_deref()
        .map(|value| barcode(Some(value)))
        .transpose()?;
    let row = inventory_adjustment_service::update(
        &state,
        InventoryUpdateInput {
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
            barcode: barcode.as_deref(),
            batch_tracked: payload.batch_tracked,
            active: payload.active,
            adjustment_reason: payload.adjustment_reason.as_deref(),
            idempotency_key: payload.idempotency_key.as_deref(),
        },
    )
    .await?
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

fn barcode(value: Option<&str>) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_ascii_uppercase();
    if value.len() > 120
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "-. $/+%".contains(ch))
    {
        return Err(AppError::validation(
            "barcode must use Code 39 letters, numbers, spaces or -.$/+%",
        ));
    }
    Ok(value)
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
            barcode: record.barcode,
            batch_tracked: record.batch_tracked,
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
