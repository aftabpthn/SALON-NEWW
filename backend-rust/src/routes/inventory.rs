use crate::state::AppState;
use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::inventory_repository::{self, InventoryRecord},
    routes::context::{current_business_date, tenant_branch},
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
    pub with_count: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedControlsQuery {
    pub dead_stock_days: Option<i64>,
    pub limit: Option<usize>,
    pub all_branches: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlReconciliationQuery {
    pub as_of: Option<chrono::NaiveDate>,
    pub all_branches: Option<bool>,
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
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackbarUsageRequest {
    pub inventory_item_id: String,
    pub service_id: Option<String>,
    pub staff_id: Option<String>,
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
    pub actual_quantity: i32,
    #[serde(default)]
    pub wasted_quantity: i32,
    pub selected_batch_id: Option<String>,
    pub waste_reason: Option<String>,
    pub notes: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorBowlLineRequest {
    pub component_type: String,
    pub inventory_item_id: String,
    pub actual_quantity: i32,
    #[serde(default)]
    pub waste_reason: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorBowlRequest {
    pub appointment_id: String,
    pub client_id: String,
    pub service_id: String,
    pub staff_id: String,
    #[serde(default)]
    pub notes: String,
    pub idempotency_key: String,
    pub lines: Vec<ColorBowlLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorBowlQuery {
    pub date: Option<chrono::NaiveDate>,
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorVarianceQuery {
    pub date: Option<chrono::NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaRecommendationQuery {
    pub client_id: String,
    pub service_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackbarReviewRequest {
    pub decision: String,
    pub review_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackbarReversalRequest {
    pub reason: String,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryExceptionReviewRequest {
    pub evidence_hash: String,
    pub decision: String,
    pub review_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventoryAutomationPolicyRequest {
    pub enabled: bool,
    pub auto_transfer_drafts: bool,
    pub auto_po_drafts: bool,
    pub monthly_budget_paise: i64,
    #[serde(default)]
    pub category_budgets_paise: Option<serde_json::Value>,
    pub expiry_rescue_days: i32,
    pub run_interval_minutes: i32,
    pub escalation_minutes: i32,
    pub min_confidence_bps: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventoryAutomationReviewRequest {
    pub decision: String,
    pub review_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PurchaseOptimizerRequest {
    pub lines: Vec<PurchaseOptimizerLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PurchaseOptimizerLineRequest {
    pub inventory_item_id: String,
    pub quantity: i32,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryWriteRequest {
    pub sku: Option<String>,
    pub name: Option<String>,
    pub category: Option<String>,
    pub subcategory: Option<String>,
    pub brand: Option<String>,
    pub product_usage: Option<String>,
    pub unit: Option<String>,
    pub package_unit: Option<String>,
    pub units_per_package: Option<i32>,
    pub stock_quantity: Option<i32>,
    pub reorder_point: Option<i32>,
    pub alert_level: Option<i32>,
    pub desired_level: Option<i32>,
    pub order_level: Option<i32>,
    pub safety_stock_level: Option<i32>,
    pub unit_cost_paise: Option<i64>,
    pub retail_price_paise: Option<i64>,
    pub hsn_code: Option<String>,
    pub gst_percent: Option<i32>,
    pub barcode: Option<String>,
    pub barcodes: Option<Vec<String>>,
    pub batch_tracked: Option<bool>,
    pub dual_use_stock: Option<bool>,
    pub center_available: Option<bool>,
    pub online_sale_enabled: Option<bool>,
    pub active: Option<bool>,
    pub adjustment_reason: Option<String>,
    pub adjustment_evidence_reference: Option<String>,
    pub adjustment_business_date: Option<String>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductLifecycleRequest {
    pub reason: String,
    pub replacement_inventory_item_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductCloneRequest {
    pub sku: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkInventoryUpdateRequest {
    pub ids: Vec<String>,
    pub center_available: Option<bool>,
    pub online_sale_enabled: Option<bool>,
    pub reorder_point: Option<i32>,
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
    pub auto_unbundle_on_receive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitAssemblyRequest {
    pub quantity: i32,
    pub idempotency_key: String,
    pub comments: Option<String>,
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
    pub subcategory: String,
    pub brand: String,
    pub product_usage: String,
    pub unit: String,
    pub package_unit: String,
    pub units_per_package: i32,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub alert_level: i32,
    pub desired_level: i32,
    pub order_level: i32,
    pub safety_stock_level: i32,
    pub unit_cost_paise: i64,
    pub retail_price_paise: i64,
    pub hsn_code: String,
    pub gst_percent: i32,
    pub barcode: String,
    pub barcodes: Vec<String>,
    pub batch_tracked: bool,
    pub dual_use_stock: bool,
    pub center_available: bool,
    pub online_sale_enabled: bool,
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
    pub retail_shelf_quantity: i64,
    pub sealed_backbar_quantity: i64,
    pub sealed_backbar_balance: i64,
    pub open_container_balance: i64,
    pub physical_total_quantity: i64,
    pub open_container_unit: Option<String>,
    pub kit_components: Vec<inventory_repository::InventoryKitComponentRecord>,
    pub kit_auto_unbundle_on_receive: bool,
    pub kit_history: Vec<inventory_repository::InventoryKitOperationRecord>,
    pub branch_stocks: serde_json::Value,
    pub expiry_timeline: serde_json::Value,
    pub client_usage: serde_json::Value,
    pub entity_ledger: serde_json::Value,
    pub margin: serde_json::Value,
    pub lifecycle_events: Vec<serde_json::Value>,
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
            "/inventory/command-center",
            axum::routing::get(command_center),
        )
        .route("/inventory/transfer-optimizer", post(transfer_optimizer))
        .route(
            "/inventory/autonomous-operations",
            get(autonomous_operations).put(save_autonomous_operations),
        )
        .route(
            "/inventory/autonomous-operations/run",
            post(run_autonomous_operations),
        )
        .route(
            "/inventory/autonomous-operations/actions/:id/review",
            post(review_autonomous_operation),
        )
        .route(
            "/inventory/exception-recommendations/:key/review",
            post(review_exception_recommendation),
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
        .route(
            "/inventory/backbar-usage/:id/reverse",
            axum::routing::post(reverse_backbar_usage),
        )
        .route(
            "/inventory/color-bowls",
            axum::routing::get(list_color_bowls).post(record_color_bowl),
        )
        .route(
            "/inventory/color-bowls/daily-variance",
            axum::routing::get(daily_color_variance),
        )
        .route(
            "/inventory/color-bowls/formula-recommendation",
            axum::routing::get(formula_recommendation),
        )
        .route(
            "/inventory/color-bowls/service-margins",
            axum::routing::get(color_service_margins),
        )
        .route(
            "/inventory/color-bowls/staff-shift-dashboard",
            axum::routing::get(color_staff_shift_dashboard),
        )
        .route(
            "/inventory/service-recipes/:id/versions",
            get(service_recipe_versions),
        )
        .route("/inventory/:id/360", axum::routing::get(product_360))
        .route(
            "/inventory/bulk",
            axum::routing::patch(bulk_update_inventory),
        )
        .route("/inventory/:id/clone", post(clone_inventory))
        .route("/inventory/:id/discontinue", post(discontinue_inventory))
        .route("/inventory/:id/reactivate", post(reactivate_inventory))
        .route("/inventory/:id/kit", get(get_kit).put(save_kit))
        .route("/inventory/:id/assemble", post(assemble_kit))
        .route("/inventory/:id/unbundle", post(unbundle_kit))
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
    Extension(claims): Extension<AuthClaims>,
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
        payload.auto_unbundle_on_receive,
        &claims.sub,
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
        payload.comments.as_deref().unwrap_or_default(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn unbundle_kit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<KitAssemblyRequest>,
) -> ApiResult<inventory_adjustment_service::KitAssemblyResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_adjustment_service::unbundle_kit(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        inventory_adjustment_service::KitOperationInput {
            quantity: payload.quantity,
            idempotency_key: &payload.idempotency_key,
            actor_user_id: &claims.sub,
            comments: payload.comments.as_deref().unwrap_or_default(),
        },
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
        query.client_id.as_deref().unwrap_or_default(),
        query.appointment_id.as_deref().unwrap_or_default(),
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
            client_id: payload.client_id.as_deref(),
            appointment_id: payload.appointment_id.as_deref(),
            actual_quantity: payload.actual_quantity,
            wasted_quantity: payload.wasted_quantity,
            selected_batch_id: payload.selected_batch_id.as_deref(),
            waste_reason: payload.waste_reason.as_deref().unwrap_or_default(),
            notes: payload.notes.as_deref().unwrap_or_default(),
            actor_user_id: &claims.sub,
            idempotency_key: &payload.idempotency_key,
            override_authorized: claims.role.eq_ignore_ascii_case("owner")
                || claims
                    .permissions
                    .iter()
                    .any(|permission| permission == "inventory.approve"),
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
            "manager approval is required for recipe variance",
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

async fn reverse_backbar_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<BackbarReversalRequest>,
) -> ApiResult<inventory_repository::BackbarUsageRecord> {
    if !claims.role.eq_ignore_ascii_case("owner")
        && !claims
            .permissions
            .iter()
            .any(|permission| permission == "inventory.approve")
    {
        return Err(AppError::forbidden(
            "manager approval is required to reverse usage",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_adjustment_service::reverse_backbar_usage(
        &state,
        inventory_adjustment_service::BackbarReversalInput {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            usage_id: &id,
            reason: &payload.reason,
            actor_user_id: &claims.sub,
            idempotency_key: &payload.idempotency_key,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_color_bowls(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ColorBowlQuery>,
) -> ApiResult<Vec<serde_json::Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_repository::list_color_bowls(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date,
        query.client_id.as_deref().unwrap_or_default(),
        query.appointment_id.as_deref().unwrap_or_default(),
        query.limit.unwrap_or(100).clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to list colour bowls"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn record_color_bowl(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<ColorBowlRequest>,
) -> ApiResult<serde_json::Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_adjustment_service::record_color_bowl(
        &state,
        inventory_adjustment_service::ColorBowlInput {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            appointment_id: &payload.appointment_id,
            client_id: &payload.client_id,
            service_id: &payload.service_id,
            staff_id: &payload.staff_id,
            notes: &payload.notes,
            actor_user_id: &claims.sub,
            idempotency_key: &payload.idempotency_key,
            override_authorized: claims.role.eq_ignore_ascii_case("owner")
                || claims
                    .permissions
                    .iter()
                    .any(|permission| permission == "inventory.approve"),
            lines: payload
                .lines
                .into_iter()
                .map(|line| inventory_adjustment_service::ColorBowlLineInput {
                    component_type: line.component_type,
                    inventory_item_id: line.inventory_item_id,
                    actual_quantity: line.actual_quantity,
                    waste_reason: line.waste_reason,
                    notes: line.notes,
                })
                .collect(),
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn daily_color_variance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ColorVarianceQuery>,
) -> ApiResult<Vec<serde_json::Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_repository::daily_color_variance(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date.unwrap_or_else(current_business_date),
    )
    .await
    .map_err(|_| AppError::internal("failed to load daily colour variance"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn formula_recommendation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FormulaRecommendationQuery>,
) -> ApiResult<Option<serde_json::Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if query.client_id.trim().is_empty() || query.service_id.trim().is_empty() {
        return Err(AppError::validation("clientId and serviceId are required"));
    }
    let row = inventory_repository::client_formula_recommendation(
        &state.db,
        &tenant_id,
        &branch_id,
        query.client_id.trim(),
        query.service_id.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load client formula recommendation"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn color_service_margins(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ColorVarianceQuery>,
) -> ApiResult<Vec<serde_json::Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_repository::color_service_margins(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date.unwrap_or_else(current_business_date),
    )
    .await
    .map_err(|_| AppError::internal("failed to load colour service margins"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn color_staff_shift_dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ColorVarianceQuery>,
) -> ApiResult<Vec<serde_json::Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_repository::color_staff_shift_dashboard(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date.unwrap_or_else(current_business_date),
    )
    .await
    .map_err(|_| AppError::internal("failed to load colour staff dashboard"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn advanced_controls(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<AdvancedControlsQuery>,
) -> ApiResult<inventory_controls_service::AdvancedControlsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let policy =
        crate::services::inventory_governance_service::policy(&state.db, &tenant_id, &branch_id)
            .await?;
    let expiry_window = policy
        .get("expiryWindowDays")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(30);
    let all_branches = query.all_branches.unwrap_or(false);
    if all_branches
        && !matches!(
            claims.role.as_str(),
            "owner" | "admin" | "manager" | "analyst" | "inventory_manager" | "inventoryManager"
        )
    {
        return Err(AppError::forbidden(
            "multi-branch inventory controls role is required",
        ));
    }
    let response = inventory_controls_service::advanced_controls(
        &state,
        &tenant_id,
        &branch_id,
        query.dead_stock_days.unwrap_or(90).clamp(7, 730),
        expiry_window.clamp(1, 3650),
        query.limit.unwrap_or(80).clamp(1, 250),
        all_branches,
    )
    .await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn command_center(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<inventory_controls_service::InventoryCommandCenterResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let response =
        inventory_controls_service::command_center(&state, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn transfer_optimizer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PurchaseOptimizerRequest>,
) -> ApiResult<Vec<inventory_repository::InventoryTransferOpportunity>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_controls_service::optimize_purchase(
        &state,
        &tenant_id,
        &branch_id,
        payload
            .lines
            .into_iter()
            .map(|line| inventory_controls_service::PurchaseOptimizerLine {
                inventory_item_id: line.inventory_item_id,
                quantity: line.quantity,
                unit_cost_paise: line.unit_cost_paise,
            })
            .collect(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn autonomous_operations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<inventory_controls_service::InventoryAutomationOverview> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let response =
        inventory_controls_service::automation_overview(&state, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn save_autonomous_operations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<InventoryAutomationPolicyRequest>,
) -> ApiResult<inventory_controls_service::InventoryAutomationOverview> {
    if !matches!(claims.role.as_str(), "owner" | "admin") {
        return Err(AppError::forbidden(
            "owner or admin role is required to change autonomous inventory policy",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let response = inventory_controls_service::save_automation_policy(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        inventory_controls_service::InventoryAutomationPolicyInput {
            enabled: payload.enabled,
            auto_transfer_drafts: payload.auto_transfer_drafts,
            auto_po_drafts: payload.auto_po_drafts,
            monthly_budget_paise: payload.monthly_budget_paise,
            category_budgets_paise: payload.category_budgets_paise,
            expiry_rescue_days: payload.expiry_rescue_days,
            run_interval_minutes: payload.run_interval_minutes,
            escalation_minutes: payload.escalation_minutes,
            min_confidence_bps: payload.min_confidence_bps,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn run_autonomous_operations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<inventory_controls_service::InventoryAutomationOverview> {
    if !matches!(claims.role.as_str(), "owner" | "admin" | "manager")
        && !claims
            .permissions
            .iter()
            .any(|permission| permission == "inventory.manage")
    {
        return Err(AppError::forbidden(
            "inventory management permission is required",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let response =
        inventory_controls_service::run_automation(&state, &tenant_id, &branch_id, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn review_autonomous_operation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InventoryAutomationReviewRequest>,
) -> ApiResult<inventory_repository::InventoryAutomationAction> {
    if !claims.role.eq_ignore_ascii_case("owner")
        && !claims.role.eq_ignore_ascii_case("admin")
        && !claims
            .permissions
            .iter()
            .any(|permission| permission == "inventory.approve")
    {
        return Err(AppError::forbidden(
            "inventory approval permission is required",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let response = inventory_controls_service::review_automation_action(
        &state,
        &tenant_id,
        &branch_id,
        id.trim(),
        &claims.sub,
        payload.decision.trim(),
        payload.review_note.as_deref().unwrap_or_default(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(response)))
}

async fn review_exception_recommendation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(payload): Json<InventoryExceptionReviewRequest>,
) -> ApiResult<inventory_repository::InventoryExceptionReviewRecord> {
    if !claims.role.eq_ignore_ascii_case("owner")
        && !claims.role.eq_ignore_ascii_case("admin")
        && !claims
            .permissions
            .iter()
            .any(|permission| permission == "inventory.approve")
    {
        return Err(AppError::forbidden(
            "inventory approval permission is required",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let review = inventory_controls_service::review_exception_recommendation(
        &state,
        &tenant_id,
        &branch_id,
        key.trim(),
        payload.evidence_hash.trim(),
        payload.decision.trim(),
        payload.review_note.as_deref().unwrap_or_default(),
        &claims.sub,
    )
    .await?;
    Ok(Json(ApiResponse::ok(review)))
}

async fn gl_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<GlReconciliationQuery>,
) -> ApiResult<inventory_controls_service::GlReconciliationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let today = chrono::Utc::now().date_naive();
    let as_of = query.as_of.unwrap_or(today);
    if as_of > today {
        return Err(AppError::validation("asOf cannot be in the future"));
    }
    let all_branches = query.all_branches.unwrap_or(false);
    let role = claims.role.trim().to_ascii_lowercase();
    if all_branches
        && !matches!(
            role.as_str(),
            "owner" | "admin" | "manager" | "analyst" | "accountant"
        )
    {
        return Err(AppError::forbidden(
            "multi-branch GL reconciliation role is required",
        ));
    }
    let response = inventory_controls_service::gl_reconciliation(
        &state,
        &tenant_id,
        &branch_id,
        as_of,
        all_branches,
    )
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
    let movement = query.movement.unwrap_or_default().trim().to_string();
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
        "kit_component_out",
        "kit_assembly_in",
        "kit_unbundle_out",
        "kit_component_in",
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
    let policy =
        crate::services::inventory_governance_service::policy(&state.db, &tenant_id, &branch_id)
            .await?;
    let fifo = policy
        .get("valuationMethod")
        .and_then(serde_json::Value::as_str)
        == Some("fifo");
    let rows = if fifo {
        crate::repositories::inventory_governance_repository::fifo_valuation(
            &state.db, &tenant_id, &branch_id, as_of,
        )
        .await
    } else {
        inventory_repository::valuation(&state.db, &tenant_id, &branch_id, as_of).await
    }
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
    let q = query.q.unwrap_or_default().trim().to_string();
    let with_count = query.with_count.unwrap_or(false);

    if !with_count {
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

        return Ok(Json(ApiResponse::ok(
            rows.into_iter().map(InventoryResponse::from).collect(),
        )));
    }

    let (rows, total) = tokio::try_join!(
        inventory_repository::list(
            &state.db,
            &tenant_id,
            &branch_id,
            &q,
            page_size,
            (page - 1) * page_size,
        ),
        inventory_repository::count(&state.db, &tenant_id, &branch_id, &q),
    )
    .map_err(|_| AppError::internal("failed to list inventory"))?;

    Ok(Json(ApiResponse::paged(
        rows.into_iter().map(InventoryResponse::from).collect(),
        page,
        page_size,
        total,
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
    let (
        product,
        summary,
        kit_components,
        kit_auto_unbundle_on_receive,
        kit_history,
        extended,
        lifecycle_events,
    ) = tokio::try_join!(
        inventory_repository::get(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::product_360_summary(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::kit_components(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::kit_auto_unbundle_value(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::kit_history(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::product_360_extended(&state.db, &tenant_id, &branch_id, &id),
        inventory_repository::lifecycle_events(&state.db, &tenant_id, &branch_id, &id),
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
        retail_shelf_quantity: summary.retail_shelf_quantity,
        sealed_backbar_quantity: summary.sealed_backbar_quantity,
        sealed_backbar_balance: summary.sealed_backbar_balance,
        open_container_balance: summary.open_container_balance,
        physical_total_quantity: summary.physical_total_quantity,
        open_container_unit: summary.open_container_unit,
        kit_components,
        kit_auto_unbundle_on_receive,
        kit_history,
        branch_stocks: extended["branchStocks"].clone(),
        expiry_timeline: extended["expiryTimeline"].clone(),
        client_usage: extended["clientUsage"].clone(),
        entity_ledger: extended["entityLedger"].clone(),
        margin: extended["margin"].clone(),
        lifecycle_events,
    })))
}

async fn service_recipe_versions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<serde_json::Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        inventory_repository::service_recipe_versions(&state.db, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| AppError::internal("failed to load service recipe history"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_inventory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<InventoryWriteRequest>,
) -> ApiResult<InventoryResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if inventory_cost_hidden(&claims) && payload.unit_cost_paise.unwrap_or_default() != 0 {
        return Err(AppError::forbidden(
            "product cost visibility permission is required to set inventory cost",
        ));
    }
    let name = required_text(payload.name, "name is required")?;
    let product_usage =
        inventory_product_usage(payload.product_usage.as_deref().unwrap_or_else(|| {
            if payload.dual_use_stock.unwrap_or(false) {
                "dual_use"
            } else {
                "retail"
            }
        }))?;
    if payload.online_sale_enabled == Some(true) && product_usage == "consumable" {
        return Err(AppError::validation(
            "only retail or dual-use products can be sold in Webstore",
        ));
    }
    let unit = inventory_unit(payload.unit.as_deref().unwrap_or("pcs"))?;
    let package_unit = inventory_package_unit(payload.package_unit.as_deref().unwrap_or("pcs"))?;
    let units_per_package = positive_i32(payload.units_per_package, "unitsPerPackage")?;
    let hsn_code = tax_code(payload.hsn_code.as_deref(), "hsnCode")?;
    let barcodes = inventory_barcodes(payload.barcode.as_deref(), payload.barcodes.as_deref())?;
    let barcode = barcodes.first().cloned().unwrap_or_default();
    let stock_quantity = non_negative_i32(payload.stock_quantity, "stockQuantity")?;
    let reorder_point = non_negative_i32(payload.reorder_point, "reorderPoint")?;
    if payload.batch_tracked.unwrap_or(false) && stock_quantity > 0 {
        return Err(AppError::validation(
            "batch-tracked products must start at zero stock and be received through a GRN",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start inventory master transaction"))?;
    if inventory_repository::master_edit_locked(&mut tx, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to read inventory edit lock"))?
    {
        return Err(AppError::conflict(
            "inventory master editing is locked by policy",
        ));
    }
    let mut row = inventory_repository::create(
        &mut tx,
        inventory_repository::CreateInventory {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            sku: payload.sku.as_deref().unwrap_or_default(),
            name: &name,
            category: payload.category.as_deref().unwrap_or_default(),
            subcategory: payload.subcategory.as_deref().unwrap_or_default(),
            brand: payload.brand.as_deref().unwrap_or_default(),
            product_usage: &product_usage,
            unit: &unit,
            package_unit: &package_unit,
            units_per_package,
            stock_quantity,
            reorder_point,
            alert_level: payload.alert_level.map_or(Ok(reorder_point), |value| {
                non_negative_i32(Some(value), "alertLevel")
            })?,
            desired_level: payload.desired_level.map_or(Ok(reorder_point), |value| {
                non_negative_i32(Some(value), "desiredLevel")
            })?,
            order_level: payload.order_level.map_or(Ok(reorder_point), |value| {
                non_negative_i32(Some(value), "orderLevel")
            })?,
            safety_stock_level: non_negative_i32(payload.safety_stock_level, "safetyStockLevel")?,
            unit_cost_paise: non_negative_i64(payload.unit_cost_paise, "unitCostPaise")?,
            retail_price_paise: non_negative_i64(payload.retail_price_paise, "retailPricePaise")?,
            hsn_code: &hsn_code,
            gst_percent: non_negative_i32(payload.gst_percent, "gstPercent")?,
            barcode: &barcode,
            batch_tracked: payload.batch_tracked.unwrap_or(false),
            dual_use_stock: product_usage == "dual_use",
            center_available: payload.center_available.unwrap_or(true),
            online_sale_enabled: payload.online_sale_enabled.unwrap_or(false),
            active: payload.active.unwrap_or(true),
        },
    )
    .await
    .map_err(|_| AppError::conflict("SKU or barcode already exists in this branch"))?;
    inventory_repository::replace_barcodes(&mut tx, &tenant_id, &branch_id, &row.id, &barcodes)
        .await
        .map_err(|_| AppError::conflict("one or more barcodes already exist in this branch"))?;
    inventory_repository::upsert_product_master_value(
        &mut tx,
        &tenant_id,
        &branch_id,
        "category",
        payload.category.as_deref().unwrap_or_default(),
        "",
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save product category master"))?;
    let category_code = master_code(payload.category.as_deref().unwrap_or_default());
    inventory_repository::upsert_product_master_value(
        &mut tx,
        &tenant_id,
        &branch_id,
        "subcategory",
        payload.subcategory.as_deref().unwrap_or_default(),
        &category_code,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save product subcategory master"))?;
    inventory_repository::upsert_product_master_value(
        &mut tx,
        &tenant_id,
        &branch_id,
        "brand",
        payload.brand.as_deref().unwrap_or_default(),
        "",
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save product brand master"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inventory master"))?;
    row.barcodes = barcodes;

    Ok(Json(ApiResponse::ok(InventoryResponse::from(row))))
}

async fn update_inventory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InventoryWriteRequest>,
) -> ApiResult<InventoryResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if inventory_cost_hidden(&claims) && payload.unit_cost_paise.is_some() {
        return Err(AppError::forbidden(
            "product cost visibility permission is required to change inventory cost",
        ));
    }
    let unit = payload.unit.as_deref().map(inventory_unit).transpose()?;
    let package_unit = payload
        .package_unit
        .as_deref()
        .map(inventory_package_unit)
        .transpose()?;
    let units_per_package = payload
        .units_per_package
        .map(|value| positive_i32(Some(value), "unitsPerPackage"))
        .transpose()?;
    let hsn_code = payload
        .hsn_code
        .as_deref()
        .map(|value| tax_code(Some(value), "hsnCode"))
        .transpose()?;
    let barcodes = payload
        .barcodes
        .as_deref()
        .map(|values| inventory_barcodes(payload.barcode.as_deref(), Some(values)))
        .transpose()?;
    let barcode = if let Some(values) = barcodes.as_ref() {
        Some(values.first().cloned().unwrap_or_default())
    } else {
        payload
            .barcode
            .as_deref()
            .map(|value| barcode(Some(value)))
            .transpose()?
    };
    let product_usage = payload
        .product_usage
        .as_deref()
        .map(inventory_product_usage)
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
            subcategory: payload.subcategory.as_deref(),
            brand: payload.brand.as_deref(),
            product_usage: product_usage.as_deref(),
            unit: unit.as_deref(),
            package_unit: package_unit.as_deref(),
            units_per_package,
            stock_quantity: payload.stock_quantity,
            reorder_point: payload.reorder_point,
            alert_level: payload.alert_level,
            desired_level: payload.desired_level,
            order_level: payload.order_level,
            safety_stock_level: payload.safety_stock_level,
            unit_cost_paise: payload.unit_cost_paise,
            retail_price_paise: payload
                .retail_price_paise
                .map(|value| non_negative_i64(Some(value), "retailPricePaise"))
                .transpose()?,
            hsn_code: hsn_code.as_deref(),
            gst_percent: payload.gst_percent.map(|value| value.max(0)),
            barcode: barcode.as_deref(),
            barcodes: barcodes.as_deref(),
            batch_tracked: payload.batch_tracked,
            dual_use_stock: product_usage
                .as_ref()
                .map(|value| value == "dual_use")
                .or(payload.dual_use_stock),
            center_available: payload.center_available,
            online_sale_enabled: payload.online_sale_enabled,
            active: payload.active,
            adjustment_reason: payload.adjustment_reason.as_deref(),
            adjustment_evidence_reference: payload.adjustment_evidence_reference.as_deref(),
            adjustment_business_date: payload.adjustment_business_date.as_deref(),
            idempotency_key: payload.idempotency_key.as_deref(),
            actor_user_id: &claims.sub,
        },
    )
    .await?
    .ok_or_else(|| AppError::not_found("inventory item was not found"))?;

    Ok(Json(ApiResponse::ok(InventoryResponse::from(row))))
}

async fn delete_inventory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<serde_json::Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let event = inventory_repository::discontinue(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        None,
        "Deactivated from inventory master",
        &claims.sub,
    )
    .await
    .map_err(product_lifecycle_error)?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"deleted": false, "deactivated": true, "id": id, "event": event}),
    )))
}

async fn discontinue_inventory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ProductLifecycleRequest>,
) -> ApiResult<serde_json::Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let reason = required_text(Some(payload.reason), "discontinuation reason is required")?;
    let event = inventory_repository::discontinue(
        &state.db,
        &tenant,
        &branch,
        &id,
        payload.replacement_inventory_item_id.as_deref(),
        &reason,
        &claims.sub,
    )
    .await
    .map_err(product_lifecycle_error)?;
    Ok(Json(ApiResponse::ok(event)))
}

async fn reactivate_inventory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ProductLifecycleRequest>,
) -> ApiResult<serde_json::Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let reason = required_text(Some(payload.reason), "reactivation reason is required")?;
    let event =
        inventory_repository::reactivate(&state.db, &tenant, &branch, &id, &reason, &claims.sub)
            .await
            .map_err(product_lifecycle_error)?;
    Ok(Json(ApiResponse::ok(event)))
}

async fn clone_inventory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ProductCloneRequest>,
) -> ApiResult<InventoryResponse> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let source = inventory_repository::get(&state.db, &tenant, &branch, &id)
        .await
        .map_err(|_| AppError::internal("failed to load source product"))?
        .ok_or_else(|| AppError::not_found("source product was not found"))?;
    create_inventory(
        State(state),
        Extension(claims),
        headers,
        Json(InventoryWriteRequest {
            sku: Some(payload.sku),
            name: Some(payload.name),
            category: Some(source.category),
            subcategory: Some(source.subcategory),
            brand: Some(source.brand),
            product_usage: Some(source.product_usage),
            unit: Some(source.unit),
            package_unit: Some(source.package_unit),
            units_per_package: Some(source.units_per_package),
            stock_quantity: Some(0),
            reorder_point: Some(source.reorder_point),
            alert_level: Some(source.alert_level),
            desired_level: Some(source.desired_level),
            order_level: Some(source.order_level),
            safety_stock_level: Some(source.safety_stock_level),
            unit_cost_paise: Some(source.unit_cost_paise),
            retail_price_paise: Some(source.retail_price_paise),
            hsn_code: Some(source.hsn_code),
            gst_percent: Some(source.gst_percent),
            barcode: None,
            barcodes: Some(vec![]),
            batch_tracked: Some(source.batch_tracked),
            dual_use_stock: Some(source.dual_use_stock),
            center_available: Some(source.center_available),
            online_sale_enabled: Some(source.online_sale_enabled),
            active: Some(true),
            adjustment_reason: None,
            adjustment_evidence_reference: None,
            adjustment_business_date: None,
            idempotency_key: None,
        }),
    )
    .await
}

async fn bulk_update_inventory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BulkInventoryUpdateRequest>,
) -> ApiResult<serde_json::Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let mut ids = payload
        .ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    if ids.is_empty()
        || ids.len() > 200
        || payload.reorder_point.is_some_and(|value| value < 0)
        || (payload.center_available.is_none()
            && payload.online_sale_enabled.is_none()
            && payload.reorder_point.is_none())
    {
        return Err(AppError::validation("bulk product update is invalid"));
    }
    let rows = sqlx::query_scalar::<_, String>("WITH matched AS (SELECT id FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)), updated AS (UPDATE inventory_items SET center_available=COALESCE($4,center_available),online_sale_enabled=COALESCE($5,online_sale_enabled),reorder_point=COALESCE($6,reorder_point),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT id FROM matched) AND (SELECT COUNT(*) FROM matched)=CARDINALITY($3) RETURNING id) SELECT id FROM updated")
        .bind(&tenant).bind(&branch).bind(&ids).bind(payload.center_available).bind(payload.online_sale_enabled).bind(payload.reorder_point).fetch_all(&state.db).await.map_err(|_| AppError::internal("failed to bulk update products"))?;
    if rows.len() != ids.len() {
        return Err(AppError::not_found(
            "one or more inventory items were not found",
        ));
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"updated": rows.len(), "ids": rows}),
    )))
}

fn product_lifecycle_error(error: sqlx::Error) -> AppError {
    match error {
        sqlx::Error::RowNotFound => {
            AppError::not_found("inventory item was not found or already in the requested state")
        }
        sqlx::Error::Protocol(message) => AppError::validation(message),
        sqlx::Error::Database(ref value) if value.code().as_deref() == Some("23514") => {
            AppError::validation("lifecycle reason or replacement is invalid")
        }
        _ => AppError::internal("inventory product lifecycle action failed"),
    }
}

fn required_text(value: Option<String>, message: &'static str) -> Result<String, AppError> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation(message))
}

fn inventory_cost_hidden(claims: &AuthClaims) -> bool {
    claims.has_field_mask("inventory.cost")
}

fn inventory_unit(value: &str) -> Result<String, AppError> {
    let unit = value.trim().to_ascii_lowercase();
    matches!(unit.as_str(), "pcs" | "bottle" | "kit" | "ml" | "g" | "oz")
        .then_some(unit)
        .ok_or_else(|| AppError::validation("unit must be g, ml, oz, pcs, bottle, or kit"))
}

fn inventory_product_usage(value: &str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_lowercase();
    matches!(value.as_str(), "retail" | "consumable" | "dual_use")
        .then_some(value)
        .ok_or_else(|| AppError::validation("productUsage must be retail, consumable, or dual_use"))
}

fn inventory_barcodes(
    primary: Option<&str>,
    values: Option<&[String]>,
) -> Result<Vec<String>, AppError> {
    let mut result = Vec::new();
    for raw in primary
        .into_iter()
        .chain(values.into_iter().flatten().map(String::as_str))
    {
        let value = barcode(Some(raw))?;
        if !value.is_empty() && !result.iter().any(|existing| existing == &value) {
            result.push(value);
        }
    }
    if result.len() > 10 {
        return Err(AppError::validation(
            "a product can have at most 10 barcodes",
        ));
    }
    Ok(result)
}

fn master_code(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn inventory_package_unit(value: &str) -> Result<String, AppError> {
    let unit = value.trim().to_ascii_lowercase();
    matches!(
        unit.as_str(),
        "pcs" | "box" | "bottle" | "jar" | "tube" | "pouch" | "pack" | "kit"
    )
    .then_some(unit)
    .ok_or_else(|| {
        AppError::validation("packageUnit must be pcs, box, bottle, jar, tube, pouch, pack, or kit")
    })
}

fn positive_i32(value: Option<i32>, field: &'static str) -> Result<i32, AppError> {
    value
        .unwrap_or(1)
        .gt(&0)
        .then_some(value.unwrap_or(1))
        .ok_or_else(|| AppError::validation(format!("{field} must be greater than 0")))
}

#[cfg(test)]
mod tests {
    use super::inventory_unit;

    #[test]
    fn inventory_unit_accepts_options_and_rejects_numbers() {
        assert_eq!(inventory_unit(" Bottle ").unwrap(), "bottle");
        assert_eq!(inventory_unit("KIT").unwrap(), "kit");
        assert!(inventory_unit("4000").is_err());
    }
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
            subcategory: record.subcategory,
            brand: record.brand,
            product_usage: record.product_usage,
            unit: record.unit,
            package_unit: record.package_unit,
            units_per_package: record.units_per_package,
            stock_quantity: record.stock_quantity,
            reorder_point: record.reorder_point,
            alert_level: record.alert_level,
            desired_level: record.desired_level,
            order_level: record.order_level,
            safety_stock_level: record.safety_stock_level,
            unit_cost_paise: record.unit_cost_paise,
            retail_price_paise: record.retail_price_paise,
            hsn_code: record.hsn_code,
            gst_percent: record.gst_percent,
            barcode: record.barcode,
            barcodes: record.barcodes,
            batch_tracked: record.batch_tracked,
            dual_use_stock: record.dual_use_stock,
            center_available: record.center_available,
            online_sale_enabled: record.online_sale_enabled,
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}
