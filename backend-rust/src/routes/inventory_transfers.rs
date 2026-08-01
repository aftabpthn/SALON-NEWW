use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::inventory_transfer_repository,
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        inventory_transfer_service::{
            self, ReceiptInput, ReturnInput, ReturnLineInput, ShipmentInput, ShipmentLineInput,
            ShipmentReceiptLineInput, TransferInput, TransferLineInput,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/inventory/transfers", get(list).post(create))
        .route("/inventory/transfers/mismatches", get(mismatches))
        .route(
            "/inventory/transfer-settings",
            get(get_settings).put(save_settings),
        )
        .route("/inventory/transfers/:id", get(get_transfer))
        .route("/inventory/transfers/:id/raise", post(raise))
        .route("/inventory/transfers/:id/approve", post(approve))
        .route("/inventory/transfers/:id/reject", post(reject))
        .route("/inventory/transfers/:id/dispatch", post(dispatch))
        .route(
            "/inventory/transfers/:id/shipments/:shipment_id/ship",
            post(ship),
        )
        .route(
            "/inventory/transfers/:id/shipments/:shipment_id/receive",
            post(receive),
        )
        .route("/inventory/transfers/:id/returns", post(create_return))
        .route("/inventory/transfers/:id/cancel", post(cancel))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransferRequest {
    #[serde(default = "default_mode")]
    mode: String,
    source_branch_id: Option<String>,
    destination_branch_id: Option<String>,
    parent_transfer_id: Option<String>,
    #[serde(default)]
    return_reason: String,
    idempotency_key: String,
    notes: Option<String>,
    lines: Vec<TransferLineRequest>,
}

fn default_mode() -> String {
    "push".to_owned()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransferLineRequest {
    source_inventory_item_id: String,
    destination_inventory_item_id: Option<String>,
    quantity: Option<i32>,
    #[serde(default)]
    retail_quantity: i32,
    #[serde(default)]
    consumable_quantity: i32,
    transfer_unit_price_paise: Option<i64>,
    #[serde(default)]
    discount_bps: i32,
    gst_percent: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShipmentRequest {
    #[serde(default)]
    shipping_paise: i64,
    #[serde(default)]
    handling_paise: i64,
    #[serde(default)]
    other_charges_paise: i64,
    lines: Vec<ShipmentLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShipmentLineRequest {
    transfer_line_id: String,
    #[serde(default)]
    retail_quantity: i32,
    #[serde(default)]
    consumable_quantity: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptRequest {
    notes: Option<String>,
    lines: Vec<ReceiptLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceiptLineRequest {
    shipment_line_id: String,
    #[serde(default)]
    received_retail_quantity: i32,
    #[serde(default)]
    received_consumable_quantity: i32,
    #[serde(default)]
    damaged_quantity: i32,
    #[serde(default)]
    expired_quantity: i32,
    #[serde(default)]
    short_quantity: i32,
    variance_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReturnRequest {
    reason: String,
    notes: Option<String>,
    idempotency_key: String,
    lines: Vec<ReturnLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReturnLineRequest {
    transfer_line_id: String,
    #[serde(default)]
    retail_quantity: i32,
    #[serde(default)]
    consumable_quantity: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NoteRequest {
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsRequest {
    center_role: String,
    default_retail_warehouse_branch_id: Option<String>,
    default_consumable_warehouse_branch_id: Option<String>,
    auto_checkout_transfers: bool,
    cannot_raise_transfer: bool,
}

#[derive(Debug, Deserialize)]
struct TransferListQuery {
    status: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TransferListQuery>,
) -> ApiResult<Vec<inventory_transfer_repository::InventoryTransfer>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if let Some(status) = query.status.as_deref() {
        if ![
            "draft",
            "raised",
            "approved",
            "dispatched",
            "in_transit",
            "partially_received",
            "received",
            "cancelled",
            "rejected",
        ]
        .contains(&status)
        {
            return Err(AppError::validation("invalid transfer status filter"));
        }
    }
    let rows = inventory_transfer_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref(),
    )
    .await
    .map_err(|_| AppError::internal("failed to list inventory transfers"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn mismatches(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<inventory_transfer_repository::TransferMismatch>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = inventory_transfer_repository::mismatches(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load transfer mismatches"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<inventory_transfer_repository::TransferCenterSettings> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::center_setting(&state, &tenant_id, &branch_id).await?,
    )))
}

async fn save_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SettingsRequest>,
) -> ApiResult<inventory_transfer_repository::TransferCenterSettings> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = inventory_transfer_service::save_center_setting(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &payload.center_role,
        clean(payload.default_retail_warehouse_branch_id.as_deref()),
        clean(payload.default_consumable_warehouse_branch_id.as_deref()),
        payload.auto_checkout_transfers,
        payload.cannot_raise_transfer,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_transfer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn create(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<TransferRequest>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = TransferInput {
        mode: payload.mode,
        source_branch_id: payload.source_branch_id,
        destination_branch_id: payload.destination_branch_id,
        parent_transfer_id: payload.parent_transfer_id,
        return_reason: payload.return_reason,
        idempotency_key: payload.idempotency_key,
        notes: payload.notes.unwrap_or_default(),
        lines: payload
            .lines
            .into_iter()
            .map(|line| TransferLineInput {
                source_inventory_item_id: line.source_inventory_item_id,
                destination_inventory_item_id: line.destination_inventory_item_id,
                quantity: line.quantity,
                retail_quantity: line.retail_quantity,
                consumable_quantity: line.consumable_quantity,
                transfer_unit_price_paise: line.transfer_unit_price_paise,
                discount_bps: line.discount_bps,
                gst_percent: line.gst_percent,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::create(&state, &tenant_id, &branch_id, &claims.sub, input)
            .await?,
    )))
}

async fn raise(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::raise(&state, &tenant_id, &branch_id, &claims.sub, &id).await?,
    )))
}

async fn approve(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_approve(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::approve(&state, &tenant_id, &branch_id, &claims.sub, &id)
            .await?,
    )))
}

async fn reject(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<NoteRequest>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_approve(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::reject(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            payload.notes.as_deref().unwrap_or_default(),
        )
        .await?,
    )))
}

async fn dispatch(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ShipmentRequest>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = ShipmentInput {
        shipping_paise: payload.shipping_paise,
        handling_paise: payload.handling_paise,
        other_charges_paise: payload.other_charges_paise,
        lines: payload
            .lines
            .into_iter()
            .map(|line| ShipmentLineInput {
                transfer_line_id: line.transfer_line_id,
                retail_quantity: line.retail_quantity,
                consumable_quantity: line.consumable_quantity,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::dispatch_shipment(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            input,
        )
        .await?,
    )))
}

async fn ship(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, shipment_id)): Path<(String, String)>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::mark_in_transit(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            &shipment_id,
        )
        .await?,
    )))
}

async fn receive(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, shipment_id)): Path<(String, String)>,
    Json(payload): Json<ReceiptRequest>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = ReceiptInput {
        note: payload.notes.unwrap_or_default(),
        lines: payload
            .lines
            .into_iter()
            .map(|line| ShipmentReceiptLineInput {
                shipment_line_id: line.shipment_line_id,
                received_retail_quantity: line.received_retail_quantity,
                received_consumable_quantity: line.received_consumable_quantity,
                damaged_quantity: line.damaged_quantity,
                expired_quantity: line.expired_quantity,
                short_quantity: line.short_quantity,
                variance_reason: line.variance_reason.unwrap_or_default(),
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::receive_shipment(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            &shipment_id,
            input,
        )
        .await?,
    )))
}

async fn create_return(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ReturnRequest>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = ReturnInput {
        reason: payload.reason,
        notes: payload.notes.unwrap_or_default(),
        idempotency_key: payload.idempotency_key,
        lines: payload
            .lines
            .into_iter()
            .map(|line| ReturnLineInput {
                transfer_line_id: line.transfer_line_id,
                retail_quantity: line.retail_quantity,
                consumable_quantity: line.consumable_quantity,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::create_return(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            input,
        )
        .await?,
    )))
}

async fn cancel(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    payload: Option<Json<NoteRequest>>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    require_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let note = payload.and_then(|Json(row)| row.notes).unwrap_or_default();
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::cancel(&state, &tenant_id, &branch_id, &claims.sub, &id, &note)
            .await?,
    )))
}

fn require_manage(claims: &AuthClaims) -> Result<(), AppError> {
    let role = claims.role.to_ascii_lowercase();
    if matches!(
        role.as_str(),
        "owner"
            | "admin"
            | "manager"
            | "inventory manager"
            | "inventory_manager"
            | "inventorymanager"
    ) || claims
        .permissions
        .iter()
        .any(|permission| matches!(permission.as_str(), "inventory.manage" | "inventory.write"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "inventory management permission is required",
        ))
    }
}

fn require_approve(claims: &AuthClaims) -> Result<(), AppError> {
    let role = claims.role.to_ascii_lowercase();
    if matches!(role.as_str(), "owner" | "admin")
        || claims
            .permissions
            .iter()
            .any(|permission| permission == "inventory.approve")
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "inventory approval permission is required",
        ))
    }
}

fn clean(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.trim().is_empty()).map(str::trim)
}
