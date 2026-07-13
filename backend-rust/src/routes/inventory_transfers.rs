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
        inventory_transfer_service::{self, TransferInput, TransferLineInput},
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/inventory/transfers", get(list).post(dispatch))
        .route("/inventory/transfers/:id", get(get_transfer))
        .route("/inventory/transfers/:id/receive", post(receive))
        .route("/inventory/transfers/:id/cancel", post(cancel))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferRequest {
    destination_branch_id: String,
    idempotency_key: String,
    notes: Option<String>,
    lines: Vec<TransferLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferLineRequest {
    source_inventory_item_id: String,
    destination_inventory_item_id: String,
    quantity: i32,
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
        if !["in_transit", "received", "cancelled"].contains(&status) {
            return Err(AppError::validation(
                "status must be in_transit, received, or cancelled",
            ));
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

async fn dispatch(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<TransferRequest>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    let (tenant_id, source_branch_id) = tenant_branch(&headers)?;
    let input = TransferInput {
        destination_branch_id: payload.destination_branch_id,
        idempotency_key: payload.idempotency_key,
        notes: payload.notes.unwrap_or_default(),
        lines: payload
            .lines
            .into_iter()
            .map(|line| TransferLineInput {
                source_inventory_item_id: line.source_inventory_item_id,
                destination_inventory_item_id: line.destination_inventory_item_id,
                quantity: line.quantity,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::dispatch(
            &state,
            &tenant_id,
            &source_branch_id,
            &claims.sub,
            input,
        )
        .await?,
    )))
}

async fn receive(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    let (tenant_id, destination_branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::receive(
            &state,
            &tenant_id,
            &destination_branch_id,
            &claims.sub,
            &id,
        )
        .await?,
    )))
}

async fn cancel(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<inventory_transfer_service::TransferDetails> {
    let (tenant_id, source_branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_transfer_service::cancel(&state, &tenant_id, &source_branch_id, &claims.sub, &id)
            .await?,
    )))
}
